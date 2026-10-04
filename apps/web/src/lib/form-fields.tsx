import { Button, TextField } from '@kete/design';
import { useState } from 'react';
import { Select } from '@/lib/forms';
import type { AnswerValue, FormField } from '@/lib/collections';
import * as m from '@/paraglide/messages.js';

/** A form's fields to fill in (spec 032), then sent; the page says how it went. */
export function FormFill({
  fields,
  busy,
  withName = false,
  onSend,
}: {
  fields: FormField[];
  busy: boolean;
  /** Someone without an account says who she is. */
  withName?: boolean;
  onSend: (values: Record<string, AnswerValue>, name: string) => void;
}) {
  const [values, setValues] = useState<Record<string, AnswerValue>>({});
  const [name, setName] = useState('');
  const set = (key: string, value: AnswerValue) => setValues({ ...values, [key]: value });
  const ready = fields.every(
    (f) => !f.required || (values[f.key] !== undefined && values[f.key] !== ''),
  );
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSend(values, name);
      }}
    >
      {withName && (
        <TextField
          label={m.forms_your_name()}
          value={name}
          maxLength={200}
          onChange={(e) => setName(e.target.value)}
        />
      )}
      {fields.map((f) => {
        const label = f.required ? `${f.label} *` : f.label;
        const value = values[f.key];
        if (f.type === 'long_text') {
          return (
            <label key={f.key} className="grid gap-1.5 text-body-sm font-semibold">
              {label}
              <textarea
                className="min-h-28 rounded-control border border-line-control bg-surface-control p-3 font-normal"
                value={typeof value === 'string' ? value : ''}
                maxLength={5000}
                onChange={(e) => set(f.key, e.target.value)}
              />
            </label>
          );
        }
        if (f.type === 'choice') {
          return (
            <Select
              key={f.key}
              label={label}
              value={typeof value === 'string' ? value : ''}
              onChange={(e) => set(f.key, e.target.value)}
            >
              <option value="" />
              {(f.options ?? []).map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </Select>
          );
        }
        if (f.type === 'yes_no') {
          return (
            <Select
              key={f.key}
              label={label}
              value={value === true ? 'yes' : value === false ? 'no' : ''}
              onChange={(e) => set(f.key, e.target.value === '' ? null : e.target.value === 'yes')}
            >
              <option value="" />
              <option value="yes">{m.forms_yes()}</option>
              <option value="no">{m.forms_no()}</option>
            </Select>
          );
        }
        return (
          <TextField
            key={f.key}
            label={label}
            type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
            value={value === null || value === undefined ? '' : String(value)}
            onChange={(e) =>
              set(
                f.key,
                f.type === 'number'
                  ? e.target.value === ''
                    ? null
                    : Number(e.target.value)
                  : e.target.value,
              )
            }
          />
        );
      })}
      <div>
        <Button type="submit" disabled={busy || !ready}>
          {m.forms_send()}
        </Button>
      </div>
    </form>
  );
}
