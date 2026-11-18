# Architecture — SolvNow XC AI

Helix-native IT Experience Recovery platform. This document is the source of truth for system structure; keep it in sync with code (see the drift-check in `CHANGELOG.md` entries).

## 1. System context

A single Next.js 16 application (frontend + API route handlers) backed by PostgreSQL, integrating with BMC Helix (incident source) and BWF (case management) through swappable connectors.

```mermaid
flowchart LR
  Helix["BMC Helix<br/>incident resolved"] -->|signed webhook| App
  User["Requester<br/>survey link"] -->|browser| App
  Staff["Experience / Support / CIO / Admin"] -->|authenticated| App
  App["SolvNow XC AI<br/>Next.js 16"] --> DB[("PostgreSQL<br/>Prisma")]
  App -->|create recovery case| BWF["BMC Helix BWF<br/>Experience Mgmt Team"]
```

## 2. Core flow — capture & closed-loop recovery

```mermaid
sequenceDiagram
  participant H as BMC Helix
  participant W as /api/webhooks/helix
  participant U as User (browser)
  participant S as /api/survey/submit
  participant DB as PostgreSQL
  participant B as BWF connector

  H->>W: incident resolved (X-Helix-Signature)
  W->>DB: create SurveyInvite (token, expiry)
  W-->>H: survey links (Satisfied / Unsatisfied)
  U->>S: submit response
  S->>DB: persist SurveyResponse (transaction)
  alt UNSATISFIED
    S->>DB: create RecoveryCase (PENDING)
    S->>B: createCase(assignedTeam = Experience Team)
    alt success
      B-->>S: caseId / caseNumber
      S->>DB: RecoveryCase -> CREATED
    else failure
      S->>DB: RecoveryCase -> FAILED (retryable)
    end
  end
  S-->>U: 201 (success regardless of BWF outcome)
```

Key invariant (ADR-004): the response is persisted **before** BWF is called, and BWF failure never fails the user submission — failed cases surface in the Recovery Cases queue for retry.

## 2b. Helix-sent link (ADR-009)

Helix emails the end user a link that points at this app. The app never sends the survey email. When the user clicks, the app checks with Helix (read-only) before creating the survey.

```mermaid
sequenceDiagram
  participant H as BMC Helix
  participant U as User (browser)
  participant E as /survey (entry page)
  participant C as Helix connector
  participant DB as PostgreSQL / SQLite

  H->>U: email with /survey?incident=INC…&key=…&r=SATISFIED
  U->>E: click link
  E->>C: getIncident(incident) (read-only)
  C->>H: query incident form
  H-->>C: status, requester email, group, key
  alt valid, resolved, key matches, requester present
    E->>DB: create invite + IncidentLink (one per incident)
    E-->>U: redirect to /survey/token (normal survey page)
  else anything else
    E-->>U: same generic "not valid or not available" (404)
  end
```

Link format Helix must produce: `{APP_BASE_URL}/survey?incident=<Incident Number>&key=<unguessable ID>&r=SATISFIED|UNSATISFIED`. The group and requester email are taken from Helix, never from the link. If Helix is unreachable the user sees "temporarily unavailable" (503) and nothing is created.

Limits: the key proves the link came from Helix; it does not prove the person clicking is the requester (that needs SSO). Each click calls Helix, and there is no rate limit yet (see ROADMAP).

## 3. Layered components

```mermaid
flowchart TD
  subgraph UI[App Router pages]
    Landing --> Login
    Survey[survey/token] --> ThankYou
    Dash[dashboard + /cio] --> Responses[responses list]
    Dash --> Cases[cases queue]
    Admin[admin console]
  end
  subgraph API[Route handlers /api]
    Webhook[webhooks/helix]
    SurveyApi[survey submit/context]
    Auth[auth login/logout]
    Metrics[dashboard/metrics]
    RespApi[responses list]
    CasesApi[cases list/retry]
    Settings[admin/settings]
  end
  subgraph SVC[Services]
    SurveySvc[services/survey]
    MetricsSvc[services/metrics]
  end
  subgraph LIB[Cross-cutting lib]
    Env[env] 
    AuthLib[auth + RBAC + revocation]
    Audit[audit]
    Redirect[redirect guard]
    Conn[connectors: mock / live / factory]
  end
  UI --> API --> SVC --> LIB
  SVC --> Conn
  LIB --> DB[(Prisma / PostgreSQL)]
```

## 4. Data model

```mermaid
erDiagram
  User ||--o{ AuditLog : actor
  SurveyInvite ||--o| SurveyResponse : has
  SurveyResponse ||--o| RecoveryCase : triggers

  SurveyInvite {
    string token UK
    string incidentId
    string supportGroup
    string requesterEmail
    enum status
    datetime expiresAt
  }
  SurveyResponse {
    enum satisfaction
    int productivityLossMin
    string dissatisfactionReason
    enum callbackPreference
    string comments
  }
  RecoveryCase {
    enum status
    string bwfCaseNumber
    string assignedTeam
    int attempts
    string lastError
  }
  User {
    string email UK
    enum role
    string supportGroup
    boolean active
  }
```

v0.3.0 additions (see `prisma/schema.prisma`): `SurveyInvite` gains optional request details (summary, service, type, category, priority, agent, resolved date). `SurveyResponse` has many `SurveyAttachment` (file metadata; bytes are on disk under `UPLOAD_DIR`). `SurveyReason` is the editable reason list. Settings are one JSON row in `AppSetting` (`survey.config`).

```mermaid
erDiagram
  SurveyResponse ||--o{ SurveyAttachment : has
  SurveyInvite { string requestSummary string serviceName string category string assignedAgent datetime resolvedAt }
  SurveyAttachment { string fileName string contentType int sizeBytes string storageKey UK string sha256 }
  SurveyReason { string label UK int sortOrder boolean active }
```

Submit flow with files: validate (reason, count, size, type, content) → write files → save response, attachments and case in one transaction → on failure delete the files → push case to BWF. Downloads go through `/api/attachments/[id]` (ADMIN, EXPERIENCE_TEAM, own-group SUPPORT_GROUP; never CIO).

Cardinality is enforced at the DB level: one response per invite, one case per response (unique FKs). `AppSetting` (standalone admin key/value config) is omitted from the diagram as it has no relations.

## 4b. Survey lifecycle (v0.5.0, ADR-017 to ADR-019)

```mermaid
stateDiagram-v2
  [*] --> PENDING: survey created
  PENDING --> SENT: link handed to Helix
  PENDING --> VIEWED: page opened
  SENT --> VIEWED: page opened
  PENDING --> RESPONDED
  SENT --> RESPONDED
  VIEWED --> RESPONDED: answer saved
  PENDING --> EXPIRED
  SENT --> EXPIRED
  VIEWED --> EXPIRED: past expiry (job or page open)
  PENDING --> CANCELLED
  SENT --> CANCELLED
  VIEWED --> CANCELLED: staff, with reason
  EXPIRED --> PENDING: reopen in place
  CANCELLED --> PENDING: reopen in place
  RESPONDED --> [*]: final
```

An answered survey is never changed. "Reopen" on it creates a new survey linked by `reopenedFromId`; the old one gets `replacedById`, and the incident's Helix link points to the new one.

```mermaid
flowchart LR
  Job["POST /api/jobs/run<br/>admin or X-Jobs-Secret"] --> Exp[expire overdue surveys]
  Job --> Rem{reminders on<br/>and sender set?}
  Rem -- no --> Report[report how many are due]
  Rem -- yes --> Send[claim, send, record]
  Exp --> Hist[(SurveyStatusEvent)]
  Send --> Hist
```

`SurveyStatusEvent` (inviteId, fromStatus, toStatus, note, actorId, createdAt) is deleted with its survey. `SurveyInvite` gains sentAt, viewedAt, reminderCount, lastReminderAt, replacedById, reopenedFromId. Staff names in history are shown only to System Administrator and Experience Team.

## 5. Security model

- **Sessions**: httpOnly JWT cookie (`jose`, HS256), TTL = `SESSION_TTL_HOURS`.
- **Revocation** (ADR-006, updated): `getSession()` verifies the token *and* re-reads the user from the DB — a deactivated user or changed role takes effect immediately, not at token expiry. Role/supportGroup used for scoping always come from the live record.
- **Roles (ADR-016)**: six roles; the who-may-do-what lists and data scope live in `src/lib/roles.ts`. `buildScopeFilters` fails closed. Group managers are scoped by `supportGroup`, agents by `User.agentName` = Helix assigned agent. `tests/roles.test.ts` calls every route as every role.
- **RBAC**: `requireRole()` guards API routes; server components re-check `getSession()`. The Next.js 16 proxy (`src/proxy.ts`, formerly "middleware") does a coarse cookie-presence gate on `/dashboard`, `/cases`, `/admin`.
- **Metric scoping**: `buildScopeFilters()` scopes both response counts and recovery-case counts to a `SUPPORT_GROUP` user's group (or a `SUPPORT_AGENT`'s own surveys) on the dashboard aggregate (`getDashboardMetrics`) — no cross-group leakage there.
- **Cases queue visibility (intentional, ADR-005)**: `/api/cases` and `/api/cases/[id]/retry` gate on role only (`ADMIN`/`EXPERIENCE_TEAM`) and are **not** group-scoped — every `EXPERIENCE_TEAM` account can see and retry any case org-wide. This is deliberate: ADR-005 centralizes case ownership in a single Experience Management Team, so support groups get scoped read-only *dashboards* but never own or list cases themselves. Do not read the metric-scoping bullet above as applying to these two routes.
- **Open-redirect guard**: `safeNextPath()` restricts post-login redirects to same-origin rooted paths.
- **Webhook auth**: shared `X-Helix-Signature` secret (HMAC-over-body planned, Phase 1).
- **PII**: survey responses hold requester email + free-text comments — mind exports and logs.

## 6. Connector abstraction

Business logic depends only on `HelixConnector` / `BwfConnector` interfaces (`connectors/types.ts`). A factory selects mock or live from `HELIX_MODE` / `BWF_MODE`. `HelixConnector.getIncident` is read-only (live: Helix REST, JWT login, `HPD:Help Desk` query; field names in `HELIX_FIELDS` are unverified defaults). The live Helix connector is built and tested against a fake Helix server only; it has not been run against a real Helix. The live BWF adapter is still a placeholder — see issue #2.
