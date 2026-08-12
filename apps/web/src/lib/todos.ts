import type { OrchestrationTodo } from "@t3tools/contracts";

export function buildTodoDraftPrompt(todo: Pick<OrchestrationTodo, "title" | "notes">): string {
    return todo.notes.length > 0 ? `${todo.title}\n\n${todo.notes}` : todo.title;
}
