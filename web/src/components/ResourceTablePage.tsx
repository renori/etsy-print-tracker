import { useState } from "react";
import { DataTable, type Column } from "./DataTable";
import { Modal } from "./Modal";
import { FieldForm, type FieldConfig } from "./FieldForm";
import { Button, PageHeader } from "./ui";

interface ResourceHooks<T extends { id: string }> {
  useList: () => { data?: T[]; isLoading: boolean };
  useCreate: () => { mutate: (data: Partial<T>) => void };
  useUpdate: () => { mutate: (args: { id: string; data: Partial<T> }) => void };
  useDelete: () => { mutate: (id: string) => void };
}

export function ResourceTablePage<T extends { id: string }>({
  title,
  description,
  hooks,
  columns,
  fields,
  readOnly = false,
  actions,
  itemLabel,
  startAdding = false,
}: {
  title: string;
  description?: string;
  hooks: ResourceHooks<T>;
  columns: Column<T>[];
  fields: FieldConfig[];
  readOnly?: boolean;
  /** Extra buttons shown next to Add. */
  actions?: React.ReactNode;
  /** Singular noun for dialog titles, e.g. "expense" → "Add expense". */
  itemLabel?: string;
  /** Open the Add form right away (e.g. from a dashboard shortcut). */
  startAdding?: boolean;
}) {
  const { data, isLoading } = hooks.useList();
  const { mutate: create } = hooks.useCreate();
  const { mutate: update } = hooks.useUpdate();
  const { mutate: remove } = hooks.useDelete();
  const [editing, setEditing] = useState<T | "new" | null>(startAdding ? "new" : null);

  return (
    <div>
      <PageHeader
        title={title}
        subtitle={description}
        actions={
          (actions || !readOnly) && (
            <>
              {actions}
              {!readOnly && (
                <Button variant="primary" icon="plus" onClick={() => setEditing("new")}>
                  Add
                </Button>
              )}
            </>
          )
        }
      />

      {isLoading ? (
        <p className="py-10 text-center text-neutral-500">Loading…</p>
      ) : (
        <DataTable
          columns={columns}
          rows={data ?? []}
          onEdit={readOnly ? undefined : (row) => setEditing(row)}
          onDelete={readOnly ? undefined : (row) => confirm(`Delete this row?`) && remove(row.id)}
        />
      )}

      {editing && (
        <Modal title={`${editing === "new" ? "Add" : "Edit"} ${itemLabel ?? title}`} onClose={() => setEditing(null)}>
          <FieldForm
            fields={fields}
            initial={editing === "new" ? undefined : (editing as unknown as Record<string, unknown>)}
            onSubmit={(values) => {
              if (editing === "new") create(values as Partial<T>);
              else update({ id: editing.id, data: values as Partial<T> });
              setEditing(null);
            }}
          />
        </Modal>
      )}
    </div>
  );
}
