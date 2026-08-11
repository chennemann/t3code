import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  type OrchestrationShellSnapshot,
  type OrchestrationTodo,
  type ProjectId,
  WORKSPACE_PROJECT_ID,
} from "@t3tools/contracts";
import { createFileRoute } from "@tanstack/react-router";
import { Atom } from "effect/unstable/reactivity";
import { CheckIcon, CircleIcon, PlayIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { SidebarInset } from "../components/ui/sidebar";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { useComposerDraftStore } from "../composerDraftStore";
import { useProjects } from "../state/entities";
import { usePrimaryEnvironmentId } from "../state/environments";
import { environmentSnapshotAtom } from "../state/shell";
import { todoCommands } from "../state/todos";
import { useAtomCommand } from "../state/use-atom-command";

export const Route = createFileRoute("/_chat/todos")({ component: TodosRoute });
const EMPTY_SNAPSHOT_ATOM = Atom.make<OrchestrationShellSnapshot | null>(null);

function TodosRoute() {
  const environmentId = usePrimaryEnvironmentId();
  const snapshot = useAtomValue(
    environmentId === null ? EMPTY_SNAPSHOT_ATOM : environmentSnapshotAtom(environmentId),
  );
  const projects = useProjects().filter(
    (project) => project.environmentId === environmentId && project.id !== WORKSPACE_PROJECT_ID,
  );
  const todos = snapshot?.todos ?? [];
  const create = useAtomCommand(todoCommands.create);
  const update = useAtomCommand(todoCommands.update);
  const remove = useAtomCommand(todoCommands.delete);
  const handleNewThread = useNewThreadHandler();
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [projectId, setProjectId] = useState<ProjectId | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);

  const groups = useMemo(() => {
    const visible = todos.filter((todo) => showCompleted || todo.completedAt === null);
    return [
      { key: "inbox", title: "Inbox", items: visible.filter((todo) => todo.projectId === null) },
      ...projects.map((project) => ({
        key: project.id,
        title: project.title,
        items: visible.filter((todo) => todo.projectId === project.id),
      })),
    ].filter((group) => group.items.length > 0);
  }, [projects, showCompleted, todos]);

  const addTodo = async () => {
    const nextTitle = title.trim();
    if (environmentId === null || nextTitle.length === 0) return;
    await create({
      environmentId,
      input: {
        title: nextTitle,
        notes: notes.trim(),
        projectId,
      },
    });
    setTitle("");
    setNotes("");
  };

  const startTodo = async (todo: OrchestrationTodo) => {
    if (environmentId === null) return;
    const created = await handleNewThread(
      scopeProjectRef(environmentId, todo.projectId ?? WORKSPACE_PROJECT_ID),
    );
    if (created !== null) {
      useComposerDraftStore.getState().setPrompt(
        created.draftId,
        todo.notes.length > 0 ? `${todo.title}\n\n${todo.notes}` : todo.title,
      );
    }
  };

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background text-foreground">
      <main className="mx-auto flex h-full w-full max-w-4xl flex-col gap-6 overflow-y-auto px-6 py-8">
        <header>
          <h1 className="text-2xl font-semibold">To-dos</h1>
          <p className="mt-1 text-sm text-muted-foreground">Capture ideas now and choose a project when they are ready.</p>
        </header>

        <section className="rounded-xl border bg-card p-4">
          <Input value={title} onChange={(event) => setTitle(event.currentTarget.value)} placeholder="What do you want to do?" />
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.currentTarget.value)}
            placeholder="Notes (optional)"
            className="mt-3 min-h-20 w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <div className="mt-3 flex items-center gap-2">
            <select
              aria-label="Project"
              value={projectId ?? ""}
              onChange={(event) => setProjectId(event.currentTarget.value ? (event.currentTarget.value as ProjectId) : null)}
              className="h-9 min-w-48 rounded-md border bg-background px-3 text-sm"
            >
              <option value="">Inbox (no project)</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}
            </select>
            <Button onClick={() => void addTodo()} disabled={environmentId === null || title.trim().length === 0}>
              <PlusIcon className="size-4" /> Add
            </Button>
            <Button variant="ghost" className="ml-auto" onClick={() => setShowCompleted((value) => !value)}>
              {showCompleted ? "Hide completed" : "Show completed"}
            </Button>
          </div>
        </section>

        <div className="space-y-6">
          {groups.map((group) => (
            <section key={group.key}>
              <h2 className="mb-2 text-sm font-medium text-muted-foreground">{group.title}</h2>
              <div className="divide-y rounded-xl border bg-card">
                {group.items.map((todo) => (
                  <div key={todo.id} className="flex items-start gap-3 p-3">
                    <button
                      aria-label={todo.completedAt === null ? "Complete to-do" : "Reopen to-do"}
                      className="mt-0.5 text-muted-foreground hover:text-foreground"
                      onClick={() => environmentId && void update({ environmentId, input: { todoId: todo.id, completed: todo.completedAt === null } })}
                    >
                      {todo.completedAt === null ? <CircleIcon className="size-5" /> : <CheckIcon className="size-5" />}
                    </button>
                    <div className="min-w-0 flex-1">
                      <input
                        aria-label={`Title for ${todo.title}`}
                        defaultValue={todo.title}
                        onBlur={(event) => {
                          const next = event.currentTarget.value.trim();
                          if (environmentId && next && next !== todo.title) void update({ environmentId, input: { todoId: todo.id, title: next } });
                        }}
                        className={`w-full bg-transparent font-medium outline-none ${todo.completedAt === null ? "" : "text-muted-foreground line-through"}`}
                      />
                      <textarea
                        aria-label={`Notes for ${todo.title}`}
                        defaultValue={todo.notes}
                        placeholder="Add notes"
                        rows={todo.notes ? 2 : 1}
                        onBlur={(event) => {
                          const next = event.currentTarget.value.trim();
                          if (environmentId && next !== todo.notes) void update({ environmentId, input: { todoId: todo.id, notes: next } });
                        }}
                        className="mt-1 w-full resize-y bg-transparent text-sm text-muted-foreground outline-none placeholder:text-muted-foreground/50"
                      />
                      <select
                        aria-label={`Project for ${todo.title}`}
                        value={todo.projectId ?? ""}
                        onChange={(event) => environmentId && void update({ environmentId, input: { todoId: todo.id, projectId: event.currentTarget.value ? (event.currentTarget.value as ProjectId) : null } })}
                        className="mt-2 h-7 rounded border bg-background px-2 text-xs text-muted-foreground"
                      >
                        <option value="">Inbox</option>
                        {projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}
                      </select>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => void startTodo(todo)} title="Start thread">
                      <PlayIcon className="size-4" /> Start
                    </Button>
                    <Button size="icon-sm" variant="ghost" aria-label="Delete to-do" onClick={() => environmentId && void remove({ environmentId, input: { todoId: todo.id } })}>
                      <Trash2Icon className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </section>
          ))}
          {groups.length === 0 ? <p className="py-12 text-center text-sm text-muted-foreground">Nothing here yet.</p> : null}
        </div>
      </main>
    </SidebarInset>
  );
}
