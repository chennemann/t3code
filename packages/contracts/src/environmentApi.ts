import * as HttpApi from "effect/unstable/httpapi/HttpApi";

import {
  EnvironmentAuthHttpApi,
  EnvironmentConnectHttpApi,
  EnvironmentMetadataHttpApi,
  EnvironmentOrchestrationHttpApi,
  EnvironmentPullRequestsHttpApi,
} from "./environmentHttp.ts";

export class EnvironmentHttpApi extends HttpApi.make("environment")
  .add(EnvironmentMetadataHttpApi)
  .add(EnvironmentAuthHttpApi)
  .add(EnvironmentOrchestrationHttpApi)
  .add(EnvironmentPullRequestsHttpApi)
  .add(EnvironmentConnectHttpApi) {}
