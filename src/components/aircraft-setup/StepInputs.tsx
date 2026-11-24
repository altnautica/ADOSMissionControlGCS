"use client";

/**
 * @module aircraft-setup/StepInputs
 * @description A setup step's operator inputs: a number field with its unit
 * inside and its range under it, a picture picker for an enum whose options
 * carry pictures (the frame layouts and wing types), and large choice chips
 * for the other enums and yes/no inputs. Every control is at least 48 px.
 * @license GPL-3.0-only
 */

import { formatValue, optionText, setupImageUrl, setupText } from "@/lib/fc-setup/strings";
import type { InputOption, SetupValue, StepInput } from "@/lib/fc-setup/types";
import { cn } from "@/lib/utils";

const CONTROL = "min-h-12 rounded-md border border-border-default bg-bg-primary px-3 text-sm text-text-primary";

export function InputField({ input, value, onChange }: { input: StepInput; value: SetupValue; onChange: (v: SetupValue) => void }) {
  const label = setupText(input.label_key);
  if (input.kind === "number") {
    const range =
      input.min !== null && input.max !== null
        ? setupText("setup.overview.range", { min: formatValue(input.min), max: formatValue(input.max), unit: input.unit ?? "" }).trim()
        : null;
    return (
      <label className="flex flex-col gap-1 text-xs text-text-secondary">
        <span className="text-sm font-medium text-text-primary">{label}</span>
        <span className="relative flex items-center">
          <input
            type="number"
            inputMode="decimal"
            value={value === null ? "" : String(value)}
            min={input.min ?? undefined}
            max={input.max ?? undefined}
            step={input.step ?? "any"}
            onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
            className={cn(CONTROL, "w-full font-mono text-base tabular-nums", input.unit && "pr-16")}
            data-testid={`setup-input-${input.name}`}
          />
          {input.unit && (
            <span aria-hidden className="pointer-events-none absolute right-3 font-mono text-text-tertiary">
              {input.unit}
            </span>
          )}
        </span>
        {range && <span>{range}</span>}
      </label>
    );
  }
  const options: InputOption[] =
    input.kind === "bool"
      ? [
          { value: true, label_key: "setup.action.yes" },
          { value: false, label_key: "setup.action.no" },
        ]
      : input.options;
  const pictures = Object.keys(input.images).length > 0;
  return (
    <fieldset className="flex flex-col gap-1 text-xs text-text-secondary" data-testid={`setup-input-${input.name}`}>
      <legend className="mb-1 text-sm font-medium text-text-primary">{label}</legend>
      <div
        className={
          // Picture tiles 8 rem wide: one row per picker beside the step's
          // fields on a wide screen, wrapping only on a narrow one.
          pictures ? "grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-2 lg:auto-cols-[8rem] lg:grid-flow-col lg:grid-cols-none" : "flex flex-wrap gap-1.5"
        }
      >
        {options.map(({ value: o, label_key }) => {
          const on = o === value;
          const text = optionText(input.label_key, o, label_key);
          if (pictures) {
            const key = input.images[String(o)] ?? null;
            const image = setupImageUrl(key);
            return (
              <button
                key={String(o)}
                type="button"
                aria-pressed={on}
                onClick={() => onChange(o)}
                className={cn(
                  "flex min-h-12 flex-col items-center gap-1 rounded-lg border-2 p-1.5 text-sm",
                  on ? "border-accent-primary bg-accent-primary/10 text-text-primary" : "border-border-default bg-bg-secondary text-text-secondary hover:bg-bg-tertiary",
                )}
              >
                {image &&
                  (key?.startsWith("motor_order_") ? (
                    // Light line art drawn for a dark surface. A motor-order
                    // picture is cropped square to its motors and spin arrows
                    // (its corner title and legend repeat the tile's label),
                    // so the motor numbers read at tile size.
                    <span className="block aspect-square w-full overflow-hidden rounded-md bg-black/80">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={image} alt="" className="h-full w-full scale-[1.06] object-cover" />
                    </span>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={image} alt="" className="aspect-[16/10] w-full rounded-md bg-black/80 object-contain p-0.5" />
                  ))}
                <span className={cn("text-sm font-medium", on && "text-accent-primary")}>{text}</span>
              </button>
            );
          }
          return (
            <button
              key={String(o)}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(o)}
              className={cn(CONTROL, "min-w-16", on ? "border-accent-primary bg-accent-primary/15 text-accent-primary" : "hover:bg-bg-tertiary")}
            >
              {text}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
