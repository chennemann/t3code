import * as HttpApiEndpoint from "effect/unstable/httpapi/HttpApiEndpoint";
import * as HttpApiGroup from "effect/unstable/httpapi/HttpApiGroup";

import {
  EnvironmentAuthenticatedAuth,
  EnvironmentInternalError,
  EnvironmentScopeRequiredError,
  OptionalBearerHeaders,
} from "../environmentHttp.ts";
import { EnvironmentClientConfig } from "./portableClient.ts";

export class DownstreamEnvironmentHttpApi extends HttpApiGroup.make("environmentClient").add(
  HttpApiEndpoint.get("clientConfig", "/api/environment/client-config", {
    headers: OptionalBearerHeaders,
    success: EnvironmentClientConfig,
    error: [EnvironmentScopeRequiredError, EnvironmentInternalError],
  }).middleware(EnvironmentAuthenticatedAuth),
) {}
