import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { TrimmedString } from "../baseSchemas.ts";

export const DEFAULT_PULL_REQUEST_LINKING_INSTRUCTIONS = `Link only PRs belonging to this thread's task that you create, take over, or push to: link_pull_request, or link_pull_requests for several, full URL, excluding other stack PRs updated incidentally by queue operations, as your next call. Host tools do not link for you. If linking fails, say so. Skip PRs you only read or review, and PRs named only as background. Call watch_pull_request when asked to monitor or babysit, or when work you were asked to do, such as a merge, still waits on checks or reviews, even after an earlier unwatch. Finish any needed branch update and push first, then watch and end your turn. Otherwise act now or hand back. Delegated children never watch, even if the brief says babysit. After PR work, a child's last line is: PR <full URL>, head <SHA>, checks and reviews <state>. Links and watches persist across pushes. For PR waits, no sleep, loops, gh --watch, Monitor or ScheduleWakeup. Before handback, call unwatch_pull_request on any PR you watch.`;

export const serverSettingsFields = {
  pullRequestLinkingInstructions: Schema.String.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PULL_REQUEST_LINKING_INSTRUCTIONS)),
  ),
  terminalShellPath: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
} as const;

export const serverSettingsPatchFields = {
  pullRequestLinkingInstructions: Schema.optionalKey(Schema.String),
  terminalShellPath: Schema.optionalKey(TrimmedString),
} as const;
