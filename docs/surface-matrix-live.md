# Surface matrix · 四端一致性（D7）

Generated: 2026-11-28T08:45:11.847Z · mode: **live** · issue: **MOBL-57** · profile: software

同一 issue 经 panel / agent / mcp / audit 四条入口，逐字段比 debt / grade / criteria / coverage。
任一字段不等即 FAIL（`node tools/surface-matrix.js` 退出码 1）。

| field | panel | agent | mcp | audit |
|---|---|---|---|---|
| debt | 0 | 0 | 0 | 0 |
| grade | watch | watch | watch | watch |
| coverage.known/total | 1/3 | 1/3 | 1/3 | 1/3 |
| P1 | unknown | unknown | unknown | unknown |
| P2 | clear | clear | clear | clear |
| P3 | unknown | unknown | unknown | unknown |
| P4 | unknown | unknown | unknown | unknown |
| P5 | unknown | unknown | unknown | unknown |
| P6 | unknown | unknown | unknown | unknown |

Result: **PASS · 四端全等**

```json
{
  "panel": {
    "debt": 0,
    "grade": "watch",
    "criteria": [
      {
        "p": "P1",
        "state": "unknown"
      },
      {
        "p": "P2",
        "state": "clear"
      },
      {
        "p": "P3",
        "state": "unknown"
      },
      {
        "p": "P4",
        "state": "unknown"
      },
      {
        "p": "P5",
        "state": "unknown"
      },
      {
        "p": "P6",
        "state": "unknown"
      }
    ],
    "coverage": {
      "known": 1,
      "total": 3,
      "ratio": 0.3333333333333333
    }
  },
  "agent": {
    "debt": 0,
    "grade": "watch",
    "criteria": [
      {
        "p": "P1",
        "state": "unknown"
      },
      {
        "p": "P2",
        "state": "clear"
      },
      {
        "p": "P3",
        "state": "unknown"
      },
      {
        "p": "P4",
        "state": "unknown"
      },
      {
        "p": "P5",
        "state": "unknown"
      },
      {
        "p": "P6",
        "state": "unknown"
      }
    ],
    "coverage": {
      "known": 1,
      "total": 3,
      "ratio": 0.3333333333333333
    }
  },
  "mcp": {
    "debt": 0,
    "grade": "watch",
    "criteria": [
      {
        "p": "P1",
        "state": "unknown"
      },
      {
        "p": "P2",
        "state": "clear"
      },
      {
        "p": "P3",
        "state": "unknown"
      },
      {
        "p": "P4",
        "state": "unknown"
      },
      {
        "p": "P5",
        "state": "unknown"
      },
      {
        "p": "P6",
        "state": "unknown"
      }
    ],
    "coverage": {
      "known": 1,
      "total": 3,
      "ratio": 0.3333333333333333
    }
  },
  "audit": {
    "debt": 0,
    "grade": "watch",
    "criteria": [
      {
        "p": "P1",
        "state": "unknown"
      },
      {
        "p": "P2",
        "state": "clear"
      },
      {
        "p": "P3",
        "state": "unknown"
      },
      {
        "p": "P4",
        "state": "unknown"
      },
      {
        "p": "P5",
        "state": "unknown"
      },
      {
        "p": "P6",
        "state": "unknown"
      }
    ],
    "coverage": {
      "known": 1,
      "total": 3,
      "ratio": 0.3333333333333333
    }
  }
}
```
