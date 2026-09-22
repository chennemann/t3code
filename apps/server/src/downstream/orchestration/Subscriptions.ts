import { make as makeSubscriptions } from "../../orchestration/Subscriptions.ts";
import { projectShellStreamEvent } from "../Orchestration.ts";

export const make = makeSubscriptions(projectShellStreamEvent);
