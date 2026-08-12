import { useAtomValue } from "@effect/atom-react";
import { EnvironmentId, TodoId } from "@t3tools/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CheckCircle2Icon, CircleDashedIcon } from "lucide-react";
import { useEffect } from "react";

import ChatView from "../components/ChatView";
import { DraftId, markPromotedDraftThreadByRef, useComposerDraftStore } from "../composerDraftStore";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useThread, useThreadStatus } from "../state/entities";
import { environmentSnapshotAtom } from "../state/shell";
import { SidebarInset } from "../components/ui/sidebar";
import { usePrimarySettings } from "../hooks/useSettings";

function TodoPlanningRoute() {
  const navigate = useNavigate();
  const settings = usePrimarySettings();
  const params = Route.useParams();
  const routeDraftId = DraftId.make(params.draftId);
  const todoId = TodoId.make(params.todoId);
  const environmentId = EnvironmentId.make(params.environmentId);
  const snapshot = useAtomValue(environmentSnapshotAtom(environmentId));
  const todo = snapshot?.todos?.find((candidate) => candidate.id === todoId) ?? null;
  const threadRef = todo?.planningThreadId
    ? scopeThreadRef(environmentId, todo.planningThreadId)
    : null;
  const routeDraft = useComposerDraftStore((store) => store.getDraftSession(routeDraftId));
  const draft = routeDraft;
  const serverThread = useThread(threadRef);
  const threadStatus = useThreadStatus(threadRef);
  const started = serverThread !== null;
  const subtasks = snapshot?.todos?.filter((candidate) => candidate.parentTodoId === todoId) ?? [];

  useEffect(() => {
    if (started && threadRef) markPromotedDraftThreadByRef(threadRef);
  }, [started, threadRef]);

  useEffect(() => {
    if (snapshot !== null && (!todo || (!draft && threadStatus === "deleted"))) {
      void navigate({ to: "/todos", replace: true });
    }
  }, [draft, navigate, snapshot, threadStatus, todo]);

  if (!todo || (!draft && !started) || !threadRef) {
    return null;
  }
  const finalized = todo.plannedAt !== null;
  const agentInstructions = [
    "You are facilitating a planning session for this to-do. Do not implement it.",
    `To-do title: ${todo.title}`,
    todo.summary ? `Existing outcome summary: ${todo.summary}` : "",
    todo.specification ? `Existing specification:\n${todo.specification}` : "",
    todo.context ? `Existing context:\n${todo.context}` : "",
    todo.notes ? `Capture notes:\n${todo.notes}` : "",
    "Treat the user's visible messages as their description and answers.",
    settings.todoPlanningInstructions,
    "The final tool call must supply the short outcome summary, concise summaries for every full planning section, the complete specification, context, glossary, implementation plan, and high-level independently actionable child to-dos.",
  ].filter(Boolean).join("\n\n");

  const planningPanel = <div className="p-5">
    <div className="flex items-center gap-2">
      {finalized ? <CheckCircle2Icon className="size-5 text-green-600" /> : <CircleDashedIcon className="size-5 text-amber-600" />}
      <h1 className="font-semibold">{finalized ? "Plan finalized" : "Planning in progress"}</h1>
    </div>
    <p className="mt-2 text-sm text-muted-foreground">
      {finalized
        ? "The structured proposal was applied and the child to-dos were created."
        : "Keep refining the plan in chat. This session completes only after the agent calls finalize_todo_plan successfully."}
    </p>
    <section className="mt-6 space-y-4 text-sm">
      <div><h2 className="font-medium">To-do</h2><p className="mt-1 text-muted-foreground">{todo.title}</p></div>
      {todo.summary ? <div><h2 className="font-medium">Outcome</h2><p className="mt-1 whitespace-pre-wrap text-muted-foreground">{todo.summary}</p></div> : null}
      {todo.specification ? <div><h2 className="font-medium">Specification</h2><p className="mt-1 whitespace-pre-wrap text-muted-foreground">{todo.specification}</p></div> : null}
      {todo.context ? <div><h2 className="font-medium">Context</h2><p className="mt-1 whitespace-pre-wrap text-muted-foreground">{todo.context}</p></div> : null}
      {todo.glossary ? <div><h2 className="font-medium">Glossary</h2><p className="mt-1 whitespace-pre-wrap text-muted-foreground">{todo.glossary}</p></div> : null}
      {todo.plan ? <div><h2 className="font-medium">Plan</h2><p className="mt-1 whitespace-pre-wrap text-muted-foreground">{todo.plan}</p></div> : null}
      <div><h2 className="font-medium">Subtasks ({subtasks.length})</h2>{subtasks.length > 0 ? <ol className="mt-2 list-decimal space-y-2 pl-5">{subtasks.map((subtask) => <li key={subtask.id}><span>{subtask.title}</span>{subtask.summary ? <p className="text-xs text-muted-foreground">{subtask.summary}</p> : null}</li>)}</ol> : <p className="mt-1 text-muted-foreground">Created when the agent finalizes the plan.</p>}</div>
      {finalized ? <button className="w-full rounded-md border px-3 py-2 text-left font-medium hover:bg-muted" onClick={() => void navigate({ to: "/$environmentId/todos/$todoId", params: { environmentId, todoId } })}>Open editable details</button> : null}
    </section>
  </div>;

  return <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background text-foreground">
      <ChatView
        {...(started
          ? { environmentId, threadId: threadRef.threadId, routeKind: "server" as const }
          : { draftId: routeDraftId, environmentId, threadId: threadRef.threadId, routeKind: "draft" as const })}
        forceExpandedMobileComposer
        auxiliaryPanel={planningPanel}
        agentInstructions={agentInstructions}
      />
  </SidebarInset>;
}

export const Route = createFileRoute("/_chat/$environmentId/todo-plan/$todoId/$draftId")({ component: TodoPlanningRoute });
