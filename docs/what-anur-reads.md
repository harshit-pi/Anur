# What Anur reads

Everything the engineering plugin reads from code, by rule, and what it doesn't read yet. When someone says the map or a task report missed something, check here first:

- **Read**: should work. If it doesn't, it's a bug; add the failing case to the fixtures.
- **Partly**: works with the gap named.
- **Not yet**: a new technology to support, not a bug.

Any PR that changes a detector updates this list in the same PR (docs/patterns.md).

## Files read

| What                                                          | Status              | Notes                                                                                                                                                  |
| ------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Source in `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.py` | Read                | Tracked files only (`git grep`), so ignored output never counts                                                                                        |
| Tests, fixtures, mocks, harnesses                             | Left out on purpose | Folders `test(s)`, `__tests__`, `spec`, `e2e`, `fixture(s)`, `mock(s)`, `harness`, and `*.test.*`, `*.spec.*`, `*.harness.*`                           |
| Go, Java, Kotlin, Ruby, PHP, C#, Rust source                  | Not yet             | Their build files count for parts (below), but no calls or routes are read from them                                                                   |
| Folders skipped everywhere                                    | Left out on purpose | `node_modules`, `.git`, `cdk.out` (except as compiled templates, planned), `dist`, `build`, `.next`, `.anur`, `.venv`, `venv`, `target`, `__pycache__` |

## Repos

| What                                        | Status  | Notes                                                                                    |
| ------------------------------------------- | ------- | ---------------------------------------------------------------------------------------- |
| Git repos at any depth in the opened folder | Read    | A monorepo is one repo                                                                   |
| Two clones of one repo                      | Read    | Shown once, by their oldest root commit; the one named as on GitHub wins                 |
| Repo ID                                     | Read    | The oldest root commit, pinned in a committed `anur/repo.json` for shallow clones and CI |
| GitHub owner                                | Read    | From the `origin` remote; one system per owner, "No remote" for the rest                 |
| Git submodules                              | Not yet | Seen as nested repos only if checked out                                                 |
| Other hosts (GitLab, Bitbucket)             | Partly  | Read as repos; no owner grouping and no PR check                                         |

## Parts (from build files)

| Build file                                                            | Status   | Part                                                                                       |
| --------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------ |
| `package.json` (npm, pnpm, yarn)                                      | Read     | One package per file, by `name`; a monorepo root that only lists `workspaces` isn't a part |
| `pyproject.toml`                                                      | Read     | By the first `name = "…"` in the file, usually `[project]` or `[tool.poetry]`              |
| `go.mod`                                                              | Read     | By `module`                                                                                |
| `Cargo.toml`                                                          | Read     | By `[package] name`                                                                        |
| `serverless.yml` / `.yaml`                                            | Read     | By `service:`                                                                              |
| `cdk.json` with a TypeScript or JavaScript app (`.ts`, `.js`, `.mjs`) | Read     | Each `new XStack(app, "Name")`, across lines                                               |
| `cdk.json` with a Python app                                          | Read     | Each `XStack(app, "Name")`, keyword or positional id                                       |
| CDK stack names built at run time                                     | Not read | An f-string or template literal can't be known by rule                                     |
| `pom.xml`, `build.gradle`                                             | Not yet  | Counted as code for the Engineering offer, but not read for parts                          |
| `Gemfile`, `composer.json`, `*.csproj`                                | Not yet  | Counted as code for the offer only for Gemfile and composer.json                           |
| Terraform (`*.tf`)                                                    | Not yet  | Planned with AWS resources                                                                 |
| AWS SAM (`template.yaml`)                                             | Not yet  | Planned with AWS resources                                                                 |
| Docker, `docker-compose.yml`                                          | Not yet  |                                                                                            |

Groups between a repo and its parts come from part names by rule (tables, queues, storage, topics, keys and secrets, caches, monitoring, schedules, services), then Claude's names, which apply on their own.

## Links between repos

### HTTP routes (who serves)

| Framework                                                                       | Status  | Notes                                                                                    |
| ------------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------- |
| Express, Koa, Fastify: `router.get("/x")`, `app.post(...)`                      | Read    | Receivers named `router`, `app`, `api`, `server`, `blueprint`, `bp`, `fastify`           |
| Flask: `@app.route("/x")`, `@bp.get(...)`                                       | Read    |                                                                                          |
| FastAPI: `@app.get("/x")`, `@router.post(...)`                                  | Read    |                                                                                          |
| CDK API Gateway in TypeScript: `api.root.addResource("x")` chains               | Read    | Nested resources followed through variables in the same file                             |
| CDK API Gateway in Python: `add_resource("x")`                                  | Not yet | Snake case isn't matched yet                                                             |
| `base_path="x"` route trees with `children=[…]`                                 | Partly  | A convention of one team's config, to be replaced by Claude-proposed links with evidence |
| NestJS `@Get()`, `@Controller()`                                                | Not yet |                                                                                          |
| Django `urls.py`, Rails `routes.rb`, Spring `@GetMapping`, Go `http.HandleFunc` | Not yet |                                                                                          |
| OpenAPI / Swagger specs                                                         | Not yet |                                                                                          |
| API Gateway in CloudFormation, SAM or Serverless `http` events                  | Not yet | Planned with AWS resources                                                               |

### HTTP calls (who calls)

| Client                                                               | Status   | Notes                                                              |
| -------------------------------------------------------------------- | -------- | ------------------------------------------------------------------ |
| `fetch("/x")`, ``fetch(`${BASE}/x`)``                                | Read     | A literal path, or a template whose path after the base is literal |
| axios: `axios("/x")`, `axios.get(...)`                               | Read     |                                                                    |
| got: `got("/x")`, `got.post(...)`                                    | Read     |                                                                    |
| Python `requests.get(...)`, `httpx.post(...)`, f-strings with a base | Read     |                                                                    |
| AWS Amplify REST: `get/post/put/del({ path: "/x" })`                 | Read     | In files importing `aws-amplify/api` or `@aws-amplify/api`         |
| A team's own wrapper around a client                                 | Not read | Planned: Claude-proposed links with evidence, drawn as guessed     |
| `ky`, `aiohttp`, `urllib`, Go `net/http`, Java `HttpClient`          | Not yet  |                                                                    |
| GraphQL clients, generated SDK clients (OpenAPI, tRPC)               | Not yet  |                                                                    |

How a call becomes a line: its path matches a route segment by segment, a parameter matching any one segment, in another repo only. One repo declaring the route makes it found; several make each guessed.

### Hosts and outside services

| What                            | Status   | Notes                                                                                 |
| ------------------------------- | -------- | ------------------------------------------------------------------------------------- |
| Hosts a repo serves             | Read     | CDK `domainName` only                                                                 |
| Outside services                | Read     | Any host no repo here serves, such as Stripe, Google or Amazon, drawn as a dashed box |
| "Not cloned"                    | Read     | A host sharing a domain with one our repos serve                                      |
| Base URLs from `.env` or config | Not read | A call through `${API_URL}` matches by its path alone                                 |

### AWS resources

| What                                                                                 | Status  | Notes                         |
| ------------------------------------------------------------------------------------ | ------- | ----------------------------- |
| Lambda invoked by name (`Function.fromFunctionName`, SDK `invoke({ FunctionName })`) | Not yet | Being built                   |
| DynamoDB tables shared by name (`Table.fromTableName`, `tableName:`)                 | Not yet | Being built                   |
| SQS, SNS, S3 shared by name or ARN                                                   | Not yet | Being built                   |
| Compiled CloudFormation in `cdk.out`                                                 | Not yet | Being built; any CDK language |
| Within a stack: route → Lambda, queue → Lambda, Lambda → table (grants, environment) | Not yet | Being built                   |
| CloudFormation exports and `Fn::ImportValue`, SSM parameters                         | Not yet |                               |
| Terraform, SAM, Serverless resources                                                 | Not yet |                               |

### Packages

| What                                               | Status  | Notes          |
| -------------------------------------------------- | ------- | -------------- |
| A repo depending on another repo's package         | Not yet | Planned (22.6) |
| Packages inside a monorepo depending on each other | Not yet | Planned        |

## Task reports

| What                                          | Status  | Notes                                                                              |
| --------------------------------------------- | ------- | ---------------------------------------------------------------------------------- |
| Claude Code in a terminal                     | Read    | The `anur` plugin's `UserPromptSubmit` and `Stop` hooks, in folders opened in Anur |
| Codex, Gemini CLI, Cursor                     | Not yet | No hooks for them                                                                  |
| Categories: data, auth, calls, UI, other      | Read    | By path and added lines; the rules are in `packages/system/src/tasks.ts`           |
| Claude's choices                              | Read    | When Claude ends with a "Choices:" list, which the hook asks for                   |
| Two sessions changing the same folder at once | Partly  | Each session's report includes the other's changes made in the meantime            |
