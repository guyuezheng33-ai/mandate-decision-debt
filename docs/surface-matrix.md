# Surface matrix · 四端一致性（D7）

Generated: 2026-11-28T09:04:17.091Z · mode: **fixture** · issue: **KAN-3** · profile: software

同一 issue 经 panel / agent / mcp / audit 四条入口，逐字段比 debt / grade / criteria / coverage。
任一字段不等即 FAIL（`node tools/surface-matrix.js` 退出码 1）。

| field | panel | agent | mcp | audit |
|---|---|---|---|---|
| debt | 28 | 28 | 28 | 28 |
| grade | watch | watch | watch | watch |
| coverage.known/total | 3/3 | 3/3 | 3/3 | 3/3 |
| P1 | clear | clear | clear | clear |
| P2 | hit | hit | hit | hit |
| P3 | clear | clear | clear | clear |
| P4 | clear | clear | clear | clear |
| P5 | clear | clear | clear | clear |
| P6 | hit | hit | hit | hit |

Result: **PASS · 四端全等**

```json
{
  "panel": {
    "debt": 28,
    "grade": "watch",
    "criteria": [
      {
        "p": "P1",
        "state": "clear"
      },
      {
        "p": "P2",
        "state": "hit"
      },
      {
        "p": "P3",
        "state": "clear"
      },
      {
        "p": "P4",
        "state": "clear"
      },
      {
        "p": "P5",
        "state": "clear"
      },
      {
        "p": "P6",
        "state": "hit"
      }
    ],
    "coverage": {
      "known": 3,
      "total": 3,
      "ratio": 1
    }
  },
  "agent": {
    "debt": 28,
    "grade": "watch",
    "criteria": [
      {
        "p": "P1",
        "state": "clear"
      },
      {
        "p": "P2",
        "state": "hit"
      },
      {
        "p": "P3",
        "state": "clear"
      },
      {
        "p": "P4",
        "state": "clear"
      },
      {
        "p": "P5",
        "state": "clear"
      },
      {
        "p": "P6",
        "state": "hit"
      }
    ],
    "coverage": {
      "known": 3,
      "total": 3,
      "ratio": 1
    }
  },
  "mcp": {
    "debt": 28,
    "grade": "watch",
    "criteria": [
      {
        "p": "P1",
        "state": "clear"
      },
      {
        "p": "P2",
        "state": "hit"
      },
      {
        "p": "P3",
        "state": "clear"
      },
      {
        "p": "P4",
        "state": "clear"
      },
      {
        "p": "P5",
        "state": "clear"
      },
      {
        "p": "P6",
        "state": "hit"
      }
    ],
    "coverage": {
      "known": 3,
      "total": 3,
      "ratio": 1
    }
  },
  "audit": {
    "debt": 28,
    "grade": "watch",
    "criteria": [
      {
        "p": "P1",
        "state": "clear"
      },
      {
        "p": "P2",
        "state": "hit"
      },
      {
        "p": "P3",
        "state": "clear"
      },
      {
        "p": "P4",
        "state": "clear"
      },
      {
        "p": "P5",
        "state": "clear"
      },
      {
        "p": "P6",
        "state": "hit"
      }
    ],
    "coverage": {
      "known": 3,
      "total": 3,
      "ratio": 1
    }
  }
}
```
