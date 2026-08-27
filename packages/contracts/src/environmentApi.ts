import * as HttpApi from "effect/unstable/httpapi/HttpApi";

import { DownstreamEnvironmentHttpApi } from "./downstream/environmentHttp.ts";
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
  .add(DownstreamEnvironmentHttpApi)
  .add(EnvironmentOrchestrationHttpApi)
  .add(EnvironmentPullRequestsHttpApi)
  .add(EnvironmentConnectHttpApi) {}
