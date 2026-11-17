import { useState } from "react";
import { blackoutApi, useScheduleSettings, useUpdateScheduleSettings } from "../api/resources";
import { Modal } from "../components/Modal";
import type { ScheduleSettings } from "../api/types";
import { Button, IconButton, btn, inputClass } from "../components/ui";

export function BlackoutTimes() {
  const { data: windows, isLoading } = blackoutApi.useList();
  const { mutate: create } = blackoutApi.useCreate();
  const { mutate: remove } = blackoutApi.useDelete();
  const { data: settings } = useScheduleSettings();
  const { mutate: updateSettings } = useUpdateScheduleSettings();
  const [creating, setCreating] = useState(false);

  return (
    <div>
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">Blackout Times</h1>

      {settings && <ScheduleSettingsForm settings={settings} onSave={(data) => updateSettings(data)} />}

      <div className="mt-6 mb-1 flex items-center justify-between">
        <h2 className="font-medium text-neutral-700 dark:text-neutral-300">No-start windows</h2>
        <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
          Add
        </Button>
      </div>
      <p className="mb-3 text-sm text-neutral-500">
        No prints get started during these — a print already running keeps going. Days: Daily, Weekdays, Weekends, Mon, Tue-Thu, "Mon, Wed", or a
        date like 10/3/2026. Leave From/To blank to block the whole day.
      </p>

      {isLoading ? (
        <p className="text-neutral-400">Loading…</p>
      ) : (
        <div className="space-y-2">
          {windows?.map((w) => (
            <div key={w.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
              <div>
                <span className="font-medium">{w.daysPattern}</span> {w.fromTime || w.toTime ? `${w.fromTime ?? "midnight"} – ${w.toTime ?? "midnight"}` : "(whole day)"}
                {w.note && <span className="ml-2 text-neutral-500">· {w.note}</span>}
              </div>
              <IconButton icon="trash" label="Delete" variant="danger" onClick={() => remove(w.id)} />
            </div>
          ))}
          {(windows ?? []).length === 0 && <p className="text-neutral-400">No blackout windows set.</p>}
        </div>
      )}

      {creating && (
        <Modal title="Add Blackout Window" onClose={() => setCreating(false)}>
          <BlackoutForm onSave={(data) => create(data, { onSuccess: () => setCreating(false) })} />
        </Modal>
      )}
    </div>
  );
}

function ScheduleSettingsForm({ settings, onSave }: { settings: ScheduleSettings; onSave: (s: ScheduleSettings) => void }) {
  const [form, setForm] = useState(settings);
  return (
    <form
      className="grid grid-cols-2 gap-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900 sm:grid-cols-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(form);
      }}
    >
      <div>
        <label className="mb-1 block text-xs text-neutral-500">Morning start</label>
        <input className={inputClass} value={form.morningStart} onChange={(e) => setForm({ ...form, morningStart: e.target.value })} />
      </div>
      <div>
        <label className="mb-1 block text-xs text-neutral-500">Morning window (min)</label>
        <input type="number" className={inputClass} value={form.morningWindowMinutes} onChange={(e) => setForm({ ...form, morningWindowMinutes: Number(e.target.value) })} />
      </div>
      <div>
        <label className="mb-1 block text-xs text-neutral-500">Home time</label>
        <input className={inputClass} value={form.homeTime} onChange={(e) => setForm({ ...form, homeTime: e.target.value })} />
      </div>
      <div>
        <label className="mb-1 block text-xs text-neutral-500">Last start</label>
        <input className={inputClass} value={form.lastStart} onChange={(e) => setForm({ ...form, lastStart: e.target.value })} />
      </div>
      <div>
        <label className="mb-1 block text-xs text-neutral-500">Changeover (min)</label>
        <input type="number" className={inputClass} value={form.changeoverMinutes} onChange={(e) => setForm({ ...form, changeoverMinutes: Number(e.target.value) })} />
      </div>
      <div>
        <label className="mb-1 block text-xs text-neutral-500">Weekend start</label>
        <input className={inputClass} value={form.weekendStart} onChange={(e) => setForm({ ...form, weekendStart: e.target.value })} />
      </div>
      <div>
        <label className="mb-1 block text-xs text-neutral-500">Post office days</label>
        <input className={inputClass} value={form.postOfficeDays} onChange={(e) => setForm({ ...form, postOfficeDays: e.target.value })} />
      </div>
      <div>
        <label className="mb-1 block text-xs text-neutral-500">Post office time</label>
        <input className={inputClass} value={form.postOfficeTime} onChange={(e) => setForm({ ...form, postOfficeTime: e.target.value })} />
      </div>
      <div>
        <label className="mb-1 block text-xs text-neutral-500">Ship within (days)</label>
        <input type="number" className={inputClass} value={form.shipWithinDays} onChange={(e) => setForm({ ...form, shipWithinDays: Number(e.target.value) })} />
      </div>
      <label className="flex items-end gap-2 pb-1 text-sm">
        <input type="checkbox" checked={form.homeOnWeekends} onChange={(e) => setForm({ ...form, homeOnWeekends: e.target.checked })} />
        Home on weekends
      </label>
      <button type="submit" className={btn("primary", "md", "col-span-2 mt-1 sm:col-span-4")}>
        Save schedule settings
      </button>
    </form>
  );
}

function BlackoutForm({ onSave }: { onSave: (data: Record<string, unknown>) => void }) {
  const [daysPattern, setDaysPattern] = useState("");
  const [fromTime, setFromTime] = useState("");
  const [toTime, setToTime] = useState("");
  const [note, setNote] = useState("");
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ daysPattern, fromTime: fromTime || null, toTime: toTime || null, note: note || null });
      }}
    >
      <div>
        <label className="mb-1 block text-sm font-medium">Days (e.g. "Mon, Wed" or "Tue-Thu" or "10/3/2026")</label>
        <input required className={inputClass} value={daysPattern} onChange={(e) => setDaysPattern(e.target.value)} />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium">From (blank = whole day)</label>
        <input placeholder="7:20 PM" className={inputClass} value={fromTime} onChange={(e) => setFromTime(e.target.value)} />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium">To</label>
        <input placeholder="9:20 PM" className={inputClass} value={toTime} onChange={(e) => setToTime(e.target.value)} />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium">Note</label>
        <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <Button type="submit" variant="primary" size="lg" className="w-full">
          Save
        </Button>
    </form>
  );
}
