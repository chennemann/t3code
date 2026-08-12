import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, TodoId, type OrchestrationTodo, type ProjectId, WORKSPACE_PROJECT_ID } from "@t3tools/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeftIcon, CheckIcon, CircleIcon, ExternalLinkIcon, PlayIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { type ReactNode, useState } from "react";

import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { SidebarInset } from "../components/ui/sidebar";
import { Textarea } from "../components/ui/textarea";
import { useComposerDraftStore } from "../composerDraftStore";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { useProjects } from "../state/entities";
import { environmentSnapshotAtom } from "../state/shell";
import { todoCommands } from "../state/todos";
import { useAtomCommand } from "../state/use-atom-command";

export const Route = createFileRoute("/_chat/$environmentId/todos/$todoId")({ component: TodoDetailsRoute });

type EditableTextField = "summary" | "specification" | "context" | "glossary" | "plan" | "notes";

function TodoDetailsRoute() {
  const params = Route.useParams();
  const navigate = useNavigate();
  const environmentId = EnvironmentId.make(params.environmentId);
  const todoId = TodoId.make(params.todoId);
  const snapshot = useAtomValue(environmentSnapshotAtom(environmentId));
  const todo = snapshot?.todos?.find((candidate) => candidate.id === todoId) ?? null;
  const subtasks = snapshot?.todos?.filter((candidate) => candidate.parentTodoId === todoId) ?? [];
  const projects = useProjects().filter((project) => project.environmentId === environmentId);
  const create = useAtomCommand(todoCommands.create);
  const update = useAtomCommand(todoCommands.update);
  const remove = useAtomCommand(todoCommands.delete);
  const handleNewThread = useNewThreadHandler();
  const [subtaskTitle, setSubtaskTitle] = useState("");

  if (snapshot === null) return null;
  if (todo === null) {
    return <SidebarInset className="h-dvh p-8"><p className="text-sm text-muted-foreground">This to-do no longer exists.</p></SidebarInset>;
  }

  const saveField = (target: OrchestrationTodo, field: EditableTextField, value: string) => {
    const next = value.trim();
    if (next !== target[field]) void update({ environmentId, input: { todoId: target.id, [field]: next } });
  };
  const openTodo = (target: OrchestrationTodo) => void navigate({
    to: "/$environmentId/todos/$todoId",
    params: { environmentId, todoId: target.id },
  });
  const addSubtask = async () => {
    const title = subtaskTitle.trim();
    if (!title) return;
    await create({ environmentId, input: { title, projectId: todo.projectId, parentTodoId: todo.id } });
    setSubtaskTitle("");
  };
  const startTodo = async (target: OrchestrationTodo) => {
    const created = await handleNewThread(scopeProjectRef(environmentId, target.projectId ?? WORKSPACE_PROJECT_ID));
    if (created !== null) {
      useComposerDraftStore.getState().setPrompt(
        created.draftId,
        [target.title, target.summary, target.specification, target.context, target.plan, target.notes].filter(Boolean).join("\n\n"),
      );
    }
  };

  return <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background text-foreground">
    <main className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-6 py-8">
        <Button variant="ghost" size="sm" className="mb-5" onClick={() => void navigate({ to: "/todos" })}><ArrowLeftIcon className="size-4" /> All to-dos</Button>
        <div className="flex items-start gap-3">
          <button className="mt-2 text-muted-foreground hover:text-foreground" aria-label={todo.completedAt === null ? "Complete to-do" : "Reopen to-do"} onClick={() => void update({ environmentId, input: { todoId: todo.id, completed: todo.completedAt === null } })}>
            {todo.completedAt === null ? <CircleIcon className="size-6" /> : <CheckIcon className="size-6" />}
          </button>
          <div className="min-w-0 flex-1">
            <Input defaultValue={todo.title} aria-label="To-do title" className="h-auto border-0 px-0 text-2xl font-semibold shadow-none" onBlur={(event) => { const title = event.currentTarget.value.trim(); if (title && title !== todo.title) void update({ environmentId, input: { todoId: todo.id, title } }); }} />
            <Textarea key={`summary-${todo.updatedAt}`} defaultValue={todo.summary} aria-label="Outcome summary" placeholder="A short description of what this will bring" className="mt-2 min-h-16" onBlur={(event) => saveField(todo, "summary", event.currentTarget.value)} />
          </div>
          <select aria-label="Project" value={todo.projectId ?? ""} onChange={(event) => void update({ environmentId, input: { todoId: todo.id, projectId: event.currentTarget.value ? event.currentTarget.value as ProjectId : null } })} className="h-9 rounded-md border bg-background px-3 text-sm">
            <option value="">Inbox</option>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}
          </select>
        </div>

        <section className="mt-8 rounded-xl border bg-card">
          <div className="border-b p-4"><h2 className="font-semibold">Subtasks</h2><p className="mt-1 text-sm text-muted-foreground">Each item is a full child to-do with its own editable specification.</p></div>
          <div className="divide-y">
            {subtasks.map((subtask) => <div key={subtask.id} className="flex items-center gap-3 p-4 hover:bg-muted/40">
              <button className="cursor-pointer" aria-label={subtask.completedAt === null ? "Complete subtask" : "Reopen subtask"} onClick={() => void update({ environmentId, input: { todoId: subtask.id, completed: subtask.completedAt === null } })}>{subtask.completedAt === null ? <CircleIcon className="size-5" /> : <CheckIcon className="size-5" />}</button>
              <button className="min-w-0 flex-1 cursor-pointer text-left" onClick={() => openTodo(subtask)}><div className={subtask.completedAt === null ? "font-medium" : "font-medium text-muted-foreground line-through"}>{subtask.title}</div><div className="truncate text-sm text-muted-foreground">{subtask.summary || "No outcome described yet"}</div></button>
              <Button size="sm" variant="ghost" onClick={() => void startTodo(subtask)}><PlayIcon className="size-4" /> Start</Button>
              <Button size="sm" variant="ghost" onClick={() => openTodo(subtask)}><ExternalLinkIcon className="size-4" /> Edit</Button>
              <Button size="icon-sm" variant="ghost" aria-label="Delete subtask" onClick={() => void remove({ environmentId, input: { todoId: subtask.id } })}><Trash2Icon className="size-4" /></Button>
            </div>)}
            <form className="flex gap-2 p-4" onSubmit={(event) => { event.preventDefault(); void addSubtask(); }}><Input value={subtaskTitle} onChange={(event) => setSubtaskTitle(event.currentTarget.value)} placeholder="Add a child to-do" /><Button type="submit" disabled={!subtaskTitle.trim()}><PlusIcon className="size-4" /> Add</Button></form>
          </div>
        </section>

        <div className="mt-5 grid gap-3 lg:grid-cols-2">
          <ExpandableSection title="Specification" summary={todo.specificationSummary || summarize(todo.specification)} hint="The complete behavior, scope, and acceptance criteria."><Textarea key={`specification-${todo.updatedAt}`} defaultValue={todo.specification} placeholder="Define what must be true when this is done" className="min-h-56" onBlur={(event) => saveField(todo, "specification", event.currentTarget.value)} /></ExpandableSection>
          <ExpandableSection title="Context" summary={todo.contextSummary || summarize(todo.context)} hint="Background, constraints, references, and decisions."><Textarea key={`context-${todo.updatedAt}`} defaultValue={todo.context} placeholder="Add the context needed to make good decisions" className="min-h-56" onBlur={(event) => saveField(todo, "context", event.currentTarget.value)} /></ExpandableSection>
          <ExpandableSection title="Glossary" summary={todo.glossarySummary || summarize(todo.glossary)} hint="Terms whose meaning must stay consistent."><Textarea key={`glossary-${todo.updatedAt}`} defaultValue={todo.glossary} placeholder="Define domain terms and abbreviations" className="min-h-44" onBlur={(event) => saveField(todo, "glossary", event.currentTarget.value)} /></ExpandableSection>
          <ExpandableSection title="Plan" summary={todo.planSummary || summarize(todo.plan)} hint="The high-level route from the current state to done."><Textarea key={`plan-${todo.updatedAt}`} defaultValue={todo.plan} placeholder="Describe the implementation sequence" className="min-h-44" onBlur={(event) => saveField(todo, "plan", event.currentTarget.value)} /></ExpandableSection>
          <ExpandableSection title="Capture notes" summary={summarize(todo.notes)} hint="Raw notes preserved separately from the refined specification."><Textarea key={`notes-${todo.updatedAt}`} defaultValue={todo.notes} placeholder="Loose ideas, links, and reminders" className="min-h-32" onBlur={(event) => saveField(todo, "notes", event.currentTarget.value)} /></ExpandableSection>
        </div>
      </div>
    </main>
  </SidebarInset>;
}

function summarize(value: string) {
  const text = value.trim().replace(/\s+/g, " ");
  return text ? `${text.slice(0, 180)}${text.length > 180 ? "…" : ""}` : "Nothing added yet.";
}

function ExpandableSection({ title, summary, hint, children }: { readonly title: string; readonly summary: string; readonly hint: string; readonly children: ReactNode }) {
  return <details className="group rounded-xl border bg-card p-4"><summary className="cursor-pointer list-none"><div className="flex items-center justify-between gap-3"><h2 className="font-semibold">{title}</h2><span className="text-xs text-muted-foreground group-open:hidden">Expand</span><span className="hidden text-xs text-muted-foreground group-open:inline">Collapse</span></div><p className="mt-2 text-sm text-muted-foreground">{summary}</p></summary><div className="mt-4 border-t pt-4"><p className="mb-3 text-xs text-muted-foreground">{hint}</p>{children}</div></details>;
}
