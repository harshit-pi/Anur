import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { awsIn, awsLinks } from "./aws.ts";
import { makeRepo } from "./fixtures.ts";

const tmp = () => mkdtempSync(path.join(tmpdir(), "anur-aws-"));

/** A TypeScript CDK app: an orders table passed to a functions stack through props. */
function shop(folder: string) {
  makeRepo(
    path.join(folder, "shop"),
    {
      "package.json": '{"name":"shop"}',
      "cdk.json": '{"app":"npx ts-node bin/app.ts"}',
      "bin/app.ts": [
        'import { App } from "aws-cdk-lib";',
        "const app = new App();",
        'const data = new DataStack(app, "ShopData");',
        'const api = new OrdersStack(app, "ShopOrders", {',
        "  ordersTable: data.orders,",
        "  jobs: data.jobs,",
        "});",
      ].join("\n"),
      "lib/data.ts": [
        'import { Stack } from "aws-cdk-lib";',
        'import { TableV2 } from "aws-cdk-lib/aws-dynamodb";',
        'import * as sqs from "aws-cdk-lib/aws-sqs";',
        "export class DataStack extends Stack {",
        "  constructor(scope, id) {",
        "    super(scope, id);",
        '    this.orders = new TableV2(this, "Orders", { tableName: "ShopOrders" });',
        '    this.jobs = new sqs.Queue(this, "Jobs", { queueName: "ShopJobs" });',
        "  }",
        "}",
      ].join("\n"),
      "lib/orders.ts": [
        'import { Stack } from "aws-cdk-lib";',
        'import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";',
        'import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";',
        "export class OrdersStack extends Stack {",
        "  constructor(scope, id, props) {",
        "    super(scope, id, props);",
        '    const place = new NodejsFunction(this, "PlaceOrder", {',
        '      functionName: "PlaceOrder",',
        "      environment: { ORDERS: props.ordersTable.tableName },",
        "    });",
        "    props.ordersTable.grantReadWriteData(place);",
        '    const worker = new NodejsFunction(this, "Worker", { functionName: "OrderWorker" });',
        "    worker.addEventSource(new SqsEventSource(props.jobs));",
        "    props.ordersTable.grantReadData(worker);",
        "  }",
        "}",
      ].join("\n"),
    },
    null,
  );
}

/** A Python CDK app in another repo: the same table imported by name, given through a keyword. */
function reports(folder: string) {
  makeRepo(
    path.join(folder, "reports"),
    {
      "pyproject.toml": '[project]\nname = "reports"\n',
      "cdk.json": '{"app":"python3 app.py"}',
      "app.py": [
        "import aws_cdk as cdk",
        "app = cdk.App()",
        'shared = SharedTables(app, "ReportsShared")',
        'nightly = NightlyStack(app, "ReportsNightly", orders_table=shared.orders)',
      ].join("\n"),
      "stacks/shared.py": [
        "from aws_cdk import Stack, aws_dynamodb as dynamodb",
        "class SharedTables(Stack):",
        "    def __init__(self, scope, id, **kwargs):",
        "        super().__init__(scope, id, **kwargs)",
        '        self.orders = dynamodb.TableV2.from_table_name(self, "Orders", table_name="ShopOrders")',
      ].join("\n"),
      "stacks/nightly.py": [
        "from aws_cdk import Stack, aws_lambda as _lambda",
        "class NightlyStack(Stack):",
        "    def __init__(self, scope, id, orders_table, **kwargs):",
        "        super().__init__(scope, id, **kwargs)",
        '        fn = _lambda.Function(self, "Nightly", function_name="NightlyReport")',
        "        orders_table.grant_read_data(fn)",
      ].join("\n"),
    },
    null,
  );
}

describe("AWS resources from CDK source (22.6)", () => {
  it("reads a TypeScript app: resources, their stacks, and uses through props", () => {
    const dir = tmp();
    shop(dir);
    const { resources, uses } = awsIn(dir, "shop");
    expect(resources.map((r) => [r.key, r.stacks])).toEqual([
      ["table:ShopOrders", ["ShopData"]],
      ["queue:ShopJobs", ["ShopData"]],
      ["function:PlaceOrder", ["ShopOrders"]],
      ["function:OrderWorker", ["ShopOrders"]],
    ]);
    expect(uses.map((u) => `${u.from} ${u.action} ${u.to}`).sort()).toEqual([
      "function:OrderWorker reads table:ShopOrders",
      "function:PlaceOrder uses table:ShopOrders",
      "function:PlaceOrder writes table:ShopOrders",
      "queue:ShopJobs triggers function:OrderWorker",
    ]);
  });

  it("puts each resource in its stack when the app doesn't name it, through constructs, nested stacks and base classes", () => {
    const dir = tmp();
    makeRepo(
      path.join(dir, "pay"),
      {
        "package.json": '{"name":"pay"}',
        "cdk.json": '{"app":"npx ts-node bin/app.ts"}',
        "bin/app.ts": [
          "const app = new cdk.App();",
          'new PaymentsStack(app, "Payments", { env });',
        ].join("\n"),
        "lib/payments.ts": [
          'import * as lambda from "aws-cdk-lib/aws-lambda";',
          "export class PaymentsStack extends Stack {",
          "  constructor(scope: Construct, id: string) {",
          "    super(scope, id);",
          '    new lambda.Function(this, "Charge", { functionName: "Charge" });',
          '    new Refunds(this, "Refunds");',
          "  }",
          "}",
        ].join("\n"),
        "lib/refunds.ts": [
          'import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";',
          "export class Refunds extends Construct {",
          "  constructor(scope: Construct, id: string) {",
          "    super(scope, id);",
          '    const fn = new NodejsFunction(this, "Refund", { functionName: "Refund" });',
          "  }",
          "}",
        ].join("\n"),
      },
      null,
    );
    makeRepo(
      path.join(dir, "auth"),
      {
        "cdk.json": '{"app":"python3 app.py"}',
        "app.py": ["app = cdk.App()", 'AuthStack(app, "Auth")', "app.synth()"].join("\n"),
        "lib/auth.py": [
          "from aws_cdk import Stack",
          "class AuthStack(Stack):",
          "    def __init__(self, scope, id, **kwargs):",
          "        super().__init__(scope, id, **kwargs)",
          '        PublicApi(self, "PublicApi")',
          '        UserApi(self, "UserApi")',
        ].join("\n"),
        "lib/public_api.py": [
          "from aws_cdk import NestedStack, aws_lambda as _lambda",
          "class PublicApi(NestedStack):",
          "    def __init__(self, scope, id):",
          "        super().__init__(scope, id)",
          '        _lambda.Function(self, "SignIn", function_name="SignIn")',
        ].join("\n"),
        "lib/base.py": [
          "from aws_cdk import NestedStack, aws_lambda as _lambda",
          "class ApiBase(NestedStack):",
          "    def add_health(self):",
          '        _lambda.Function(self, "Health", function_name="Health")',
          "class UserApi(ApiBase):",
          "    pass",
        ].join("\n"),
      },
      null,
    );
    expect(awsIn(dir, "pay").resources.map((r) => [r.key, r.stacks])).toEqual([
      ["function:Charge", ["Payments"]],
      ["function:Refund", ["Payments"]],
    ]);
    expect(
      awsIn(dir, "auth")
        .resources.map((r) => [r.key, r.stacks])
        .sort(),
    ).toEqual([
      ["function:Health", ["Auth"]],
      ["function:SignIn", ["Auth"]],
    ]);
  });

  it("joins a Python repo's import to the table another repo creates, and drops a bare use beside a grant", () => {
    const dir = tmp();
    shop(dir);
    reports(dir);
    const { links } = awsLinks(dir, ["reports", "shop"]);
    expect(
      links.map((l) => [l.from.repo, l.from.name, l.action, l.to.repo, l.to.name, l.how]),
    ).toEqual([
      ["reports", "NightlyReport", "reads", "shop", "ShopOrders", "found"],
      ["shop", "OrderWorker", "reads", "shop", "ShopOrders", "found"],
      ["shop", "PlaceOrder", "writes", "shop", "ShopOrders", "found"],
      ["shop", "ShopJobs", "triggers", "shop", "OrderWorker", "found"],
    ]);
  });

  it("guesses a link from a name that matches a resource another repo creates", () => {
    const dir = tmp();
    shop(dir);
    makeRepo(
      path.join(dir, "admin"),
      {
        "package.json": '{"name":"admin"}',
        "src/run.ts": 'invoke({ FunctionName: "PlaceOrder" });\n',
      },
      null,
    );
    const guessed = awsLinks(dir, ["admin", "shop"]).links.filter((l) => l.how === "guessed");
    expect(guessed.map((l) => [l.from.repo, l.action, l.to.name, l.evidence])).toEqual([
      ["admin", "invokes", "PlaceOrder", "admin/src/run.ts:1"],
    ]);
  });
});
