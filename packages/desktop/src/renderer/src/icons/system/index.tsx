/**
 * Icons for the system map. AWS services use AWS's own Architecture Icons
 * (see aws/README.md for where they come from and the terms); the repo mark is
 * GitHub's Octicons "repo" (MIT). A package has a small glyph drawn here, and a
 * kind with no icon is drawn as a plain box. To add a kind: an SVG in aws/, one
 * entry below, and its rule in layout/system-map.ts.
 */
import cloudformation from "./aws/cloudformation.svg";
import cloudwatch from "./aws/cloudwatch.svg";
import dynamodb from "./aws/dynamodb.svg";
import elasticache from "./aws/elasticache.svg";
import eventbridge from "./aws/eventbridge.svg";
import lambda from "./aws/lambda.svg";
import s3 from "./aws/s3.svg";
import secretsManager from "./aws/secrets-manager.svg";
import sns from "./aws/sns.svg";
import sqs from "./aws/sqs.svg";

export type SystemIconKind =
  | "github"
  | "folder"
  | "function"
  | "table"
  | "queue"
  | "topic"
  | "bucket"
  | "secret"
  | "cache"
  | "schedule"
  | "monitor"
  | "stack"
  | "package";

type AwsKind = Exclude<SystemIconKind, "github" | "folder" | "package">;

const AWS: Record<AwsKind, { src: string; title: string }> = {
  function: { src: lambda, title: "AWS Lambda" },
  table: { src: dynamodb, title: "Amazon DynamoDB" },
  queue: { src: sqs, title: "Amazon SQS" },
  topic: { src: sns, title: "Amazon SNS" },
  bucket: { src: s3, title: "Amazon S3" },
  secret: { src: secretsManager, title: "AWS Secrets Manager" },
  cache: { src: elasticache, title: "Amazon ElastiCache" },
  schedule: { src: eventbridge, title: "Amazon EventBridge" },
  monitor: { src: cloudwatch, title: "Amazon CloudWatch" },
  stack: { src: cloudformation, title: "CDK stack" },
};

/** GitHub's repo mark (Octicons, MIT), and a folder for a repo with no remote. */
function RepoMark({ github }: { github: boolean }) {
  return github ? (
    <svg className="sys-icon-repo" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25a.25.25 0 0 1 .25-.25h3.5a.25.25 0 0 1 .25.25v3.25a.25.25 0 0 1-.4.2l-1.45-1.087a.249.249 0 0 0-.3 0L5.4 15.7a.25.25 0 0 1-.4-.2Z" />
    </svg>
  ) : (
    <svg className="sys-icon-repo" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M1.75 2.5h4l1.5 1.5h7a.75.75 0 0 1 .75.75v8.5a.75.75 0 0 1-.75.75H1.75a.75.75 0 0 1-.75-.75v-10a.75.75 0 0 1 .75-.75Z" />
    </svg>
  );
}

/** The icon for a kind, or nothing for a plain box. */
export function SystemIcon({ kind }: { kind: SystemIconKind | null }) {
  if (!kind) return null;
  if (kind === "github" || kind === "folder") return <RepoMark github={kind === "github"} />;
  if (kind === "package")
    return (
      <span className="sys-icon sys-pkg" title="Package" aria-hidden="true">
        <svg viewBox="0 0 20 20">
          <path d="M3 6.5 10 3l7 3.5v7L10 17l-7-3.5zM3 6.5 10 10l7-3.5M10 10v7" />
        </svg>
      </span>
    );
  const a = AWS[kind];
  return <img className="sys-icon sys-aws" src={a.src} alt="" title={a.title} draggable={false} />;
}
