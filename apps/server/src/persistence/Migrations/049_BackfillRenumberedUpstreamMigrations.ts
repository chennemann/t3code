import * as Effect from "effect/Effect";

import AuthSessionClientConnection from "./041_AuthSessionClientConnection.ts";
import ProjectionThreadLinkedPullRequest from "./042_ProjectionThreadLinkedPullRequest.ts";
import ProjectionThreadsUnsettledAt from "./043_ProjectionThreadsUnsettledAt.ts";

export default Effect.gen(function* () {
    yield* AuthSessionClientConnection;
    yield* ProjectionThreadLinkedPullRequest;
    yield* ProjectionThreadsUnsettledAt;
});
