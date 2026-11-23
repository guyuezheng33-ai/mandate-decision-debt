'use strict';

/**
 * Teamwork Graph 客户端（asUser，后端）。
 *
 * 三条平台事实决定了这个文件的形状：
 *   1. 后端要从 `@forge/api` 用 `api.asUser().requestTeamworkGraph(query, variables)`，
 *      没有 asApp 版本 —— 图的可见性必须跟随当前用户。
 *   2. 只能跑 **已注册的持久化 Cypher**（customQuery(queryKey)）。运行时不许发裸 Cypher。
 *      所以 queryKey 从环境变量读；没配就直接判定"不可用"，让端口链降级到 REST，
 *      而不是发一个必然失败的请求。
 *   3. schema 会变。这里只选最稳的字段（__typename / id / title / webUrl / displayName），
 *      映射层对缺字段一律容忍 —— 拿不到就是 null，绝不用猜测填。
 */

const { STATES } = require('../engine/normalize');



function loadApi() {
  try {
    return require('@forge/api');
  } catch {
    return null;
  }
}

/**
 * 选择集分两档：
 *  - basic（默认）：只选文档里最稳的四个字段，查询一定不会因未知字段被整段拒绝；
 *  - extended：额外选 updated / owner / contributors / status / created 等判据真正吃的字段，
 *    用 `MANDATE_GRAPH_FIELDS=extended` 打开。
 * 只选 basic 时，判据会因为"字段没回来"判 unknown（而不是 clear）——这是刻意的降级，
 * 不是坏掉：站点 schema 支持哪些字段，只有站点能回答。
 */
function buildGql(fields = 'basic') {
  const pageFields = 'title webUrl' + (fields === 'extended' ? ' lastModified author contributors' : '');
  const goalFields = 'title' + (fields === 'extended' ? ' status updated id' : '');
  const userFields = 'displayName' + (fields === 'extended' ? ' accountId' : '');
  const issueFields = fields === 'extended' ? ' created updated status statusCategoryChangedAt' : '';
  return `
query MandateProvenance($queryKey: String!, $queryParams: CypherRequestParams, $first: Int) {
  customQuery(queryKey: $queryKey, queryParams: $queryParams, first: $first) {
    edges {
      node {
        columns {
          key
          value {
            __typename
            ... on CypherQueryResultListNode {
              nodes {
                id
                data {
                  __typename${issueFields ? `\n                  ... on JiraIssue {${issueFields} }` : ''}
                  ... on ConfluencePage {${pageFields} }
                  ... on ConfluenceBlogpost {${pageFields} }
                  ... on Goal {${goalFields} }
                  ... on AtlassianUser {${userFields} }
                }
              }
            }
          }
        }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}
`;
}

const GQL = buildGql(process.env.MANDATE_GRAPH_FIELDS === 'extended' ? 'extended' : 'basic');

/**
 * 选择集被站点 schema 拒绝 vs 权限不足，必须分开处理。
 *
 * extended 选择集里有些字段（lastModified / author / contributors / Goal.status）只在部分
 * schema 版本上存在。被拒时应该退回 basic 继续出分，而不是整块降级到 REST；
 * 但 403（E_SCOPE）重试多少次都是 403，绝不能拿"少取几个字段"当权限问题的解药。
 */
function isSchemaRejection(err) {
  if (!err) return false;
  const code = String(err.code || '');
  if (code === 'E_SCOPE' || err.status === 403) return false;
  const msg = String(err.message || '');
  return (
    /Cannot query field|Unknown argument|is not defined|not found in schema|schema/i.test(msg) ||
    code === 'GRAPHQL_VALIDATION_FAILED' ||
    err.status === 400
  );
}

/** 一个节点 → 我们的条目形状。字段缺失时保留 null，不猜。 */
function nodeToItem(node) {
  const data = node?.data || {};
  const id = node?.id || data.id || null;
  return {
    id,
    title: data.title ?? data.displayName ?? null,
    url: data.webUrl ?? null,
    type: data.__typename ?? null,
    // 这几个是判据真正吃的字段：查询里返回了就带上，没返回就留空，
    // 由规则层把"没返回"压成 unknown —— 绝不用缺省值替数据源下结论。
    updated: data.updated ?? data.lastModified ?? data.lastModifiedAt ?? data.lastModifiedOn ?? null,
    owner: data.owner ?? data.author ?? data.authorId ?? data.ownerId ?? data.createdBy ?? data.creatorId ?? null,
    contributors: Array.isArray(data.contributors)
      ? data.contributors
      : Array.isArray(data.contributorIds)
        ? data.contributorIds
        : undefined,
    // 目标的状态曾经在映射层被整段丢掉，于是 P4 永远看不到"目标已关闭"。
    status: data.status?.name ?? data.status?.value ?? data.status ?? data.state ?? null,
    created: data.created ?? data.createdAt ?? null,
    inProgressSince: data.inProgressSince ?? data.statusCategoryChangedAt ?? data.statuscategorychangedate ?? null,
    reopenedCount: data.reopenedCount ?? null,
    // 复核痕迹需要"挂在哪个页面"和"谁做的"；用户节点的 id 本身就是 actor。
    pageId: data.pageId ?? data.decisionId ?? null,
    actorId: data.actorId ?? data.accountId ?? null,
    at: data.at ?? data.created ?? null,
  };
}

/** column value → 条目数组（单节点也当一条）。 */
function columnItems(value) {
  if (!value) return [];
  if (Array.isArray(value.nodes)) return value.nodes.map(nodeToItem).filter((i) => i.id || i.title);
  return [];
}

/**
 * 把 customQuery 的 columns 映射成端口需要的 raw 形状：
 * { issue, decisions, goals, reviewTraces }
 * 认不出来的 column 一律忽略 —— 多一列不会让分数变，只会让 payload 变大。
 */
function edgeValue(value) {
  // 列在、但值是空 → 是"确认没有"（absent）；列根本没回来 → 我们不知道（unknown）。
  // 这两件事在图上都长成"什么都没有"，但在分数上必须分开。
  if (value === undefined || value === null) return { state: STATES.UNKNOWN, items: [], reason: 'column-empty' };
  const items = columnItems(value);
  return { state: items.length ? STATES.PRESENT : STATES.ABSENT, items, reason: null };
}

const EDGE_ALIASES = {
  decisions: ['decisions', 'pages'],
  goals: ['goals'],
  reviewTraces: ['reviewtraces', 'contributors'],
};

/** 一行（一个 edge node）→ 一条工作项的四列。scan 的每一行都是一条 issue。 */
function mapRow(edgeNode) {
  const columns = edgeNode?.node?.columns || [];
  const row = { issue: null, decisions: undefined, goals: undefined, reviewTraces: undefined };
  for (const c of columns) {
    const key = String(c?.key || '').toLowerCase();
    if (key === 'issue' || key === 'workitem') {
      const first = columnItems(c.value)[0];
      if (first) {
        // issue 行原本只带 key 与标题，于是 P2 拿不到 asOf / 开工时间：
        // 这不是"变更未传导没命中"，是"算不了"。列里给了的元数据要一路带下去。
        row.issue = {
          key: first.id || first.title,
          summary: first.title,
          status: first.status ?? null,
          created: first.created ?? null,
          updated: first.updated ?? null,
          inProgressSince: first.inProgressSince ?? null,
          reopenedCount: first.reopenedCount ?? null,
          projectKey: null,
        };
      }
      continue;
    }
    for (const [name, aliases] of Object.entries(EDGE_ALIASES)) {
      if (aliases.includes(key)) {
        row[name] = edgeValue(c.value);
        break;
      }
    }
  }
  return row;
}

function customEdges(payload) {
  return payload?.data?.customQuery?.edges ?? payload?.customQuery?.edges ?? [];
}

function mapColumns(payload) {
  const row = mapRow(customEdges(payload)[0]);
  return {
    issue: row.issue,
    decisions: row.decisions ? row.decisions.items : [],
    goals: row.goals ? row.goals.items : [],
    reviewTraces: row.reviewTraces ? row.reviewTraces.items : [],
  };
}

/** scan：每个 edge node 是一条工作项，绝不把"若干条依据页"当成若干条 issue。 */
function mapRows(payload) {
  return customEdges(payload)
    .map(mapRow)
    .filter((r) => r.issue && (r.issue.key || r.issue.summary));
}

/**
 * @param {object} deps
 * @param {string|null} deps.bundleKey  已注册的 bundle 查询 key
 * @param {string|null} deps.scanKey    已注册的 scan 查询 key
 * @param {object} [deps.api]           注入 @forge/api（测试用）
 */
function createGraphClient({ bundleKey = null, scanKey = null, api = null, fields = null } = {}) {
  const forge = api || loadApi();
  const available = Boolean(forge && typeof forge.asUser === 'function' && bundleKey);
  // 默认仍是 basic（未在真站点验证过的选择集不进默认路径）；
  // 显式要求 extended 时，第一次被 schema 拒绝就退 basic，并且把这件事带回去。
  const requested = fields || (process.env.MANDATE_GRAPH_FIELDS === 'extended' ? 'extended' : 'basic');
  const state = { mode: requested, fellBack: false };

  async function send(gql, queryKey, queryParams, first) {
    const res = await forge.asUser().requestTeamworkGraph(gql, { queryKey, queryParams, first });
    if (res?.errors?.length) {
      // GraphQL 的错误信封长这样：errors[].extensions.code / .scope，data 为 null。
      // 平台把 403 也放在 HTTP 200 的 body 里，如果只抛 message，上层就永远拿不到 E_SCOPE，
      // 降级链会把"没权限"写成"没数据"。
      const head = res.errors[0] || {};
      const err = new Error(res.errors.map((e) => e.message || 'graph error').join('; '));
      err.graph = true;
      err.code = head.extensions?.code || 'E_GRAPH';
      err.scope = head.extensions?.scope || null;
      err.status = head.extensions?.statusCode || null;
      err.requestId = res.extensions?.requestId || head.extensions?.requestId || null;
      throw err;
    }
    return res?.data ?? null;
  }

  async function run(queryKey, queryParams, first) {
    try {
      return await send(buildGql(state.mode), queryKey, queryParams, first);
    } catch (err) {
      if (state.mode !== 'extended' || !isSchemaRejection(err)) throw err;
      // 退回 basic 再试一次；仍失败就按原错误抛，别把"没权限"包装成"字段不存在"。
      state.mode = 'basic';
      state.fellBack = true;
      return await send(buildGql('basic'), queryKey, queryParams, first);
    }
  }

  return {
    available,

    async query(req) {
      if (!available) {
        const err = new Error('teamwork graph queries are not registered');
        err.code = 'E_SCOPE';
        throw err;
      }
      if (req?.type === 'provenance.scan') {
        if (!scanKey) {
          const err = new Error('scan query is not registered');
          err.code = 'E_SCOPE';
          throw err;
        }
        const data = await run(scanKey, { projectKey: req.projectKey, limit: req.limit }, Math.min(req.limit || 25, 50));
        // 每一行是一条工作项；行内自带 decisions / goals / reviewTraces 三列。
        // 之前这里把"依据页"当成"工作项"，结果是一整页工作项全被判成"无依据"。
        // pageInfo 也不能丢：数据包的 scan 样本里 hasNextPage=true，
        // 我们只取 50 条就是"还有没看的"，界面必须能说出来。
        const pageInfo = data?.customQuery?.pageInfo || {};
        return {
          issues: mapRows({ data }),
          pageInfo: { hasNextPage: Boolean(pageInfo.hasNextPage), endCursor: pageInfo.endCursor || null },
          fields: state.mode,
          fieldsFallback: state.fellBack,
        };
      }
      const data = await run(bundleKey, { issueKey: req.issueKey }, 1);
      const row = mapRow(customEdges({ data })[0]);
      return {
        issue: row.issue,
        decisions: row.decisions,
        goals: row.goals,
        reviewTraces: row.reviewTraces,
        // 选择集退回过 basic 这件事要能一路透到界面，否则"为什么这条 P6 看不见"没人答得上。
        fields: state.mode,
        fieldsFallback: state.fellBack,
      };
    },
  };
}

module.exports = { createGraphClient, mapColumns, mapRow, mapRows, buildGql, GQL };
