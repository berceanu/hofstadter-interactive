import {
  useEffect,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { LatticeKind } from "../compute/contracts";
import {
  MAX_HOPPING_MAGNITUDE,
  useAppStore,
} from "../state/store";
import { HelpTooltip } from "./HelpTooltip";
import { parameterHelp, type HelpCopy } from "./physicsHelp";

const lattices: { value: LatticeKind; label: string }[] = [
  { value: "square", label: "Square" },
  { value: "triangular", label: "Triangular" },
  { value: "honeycomb", label: "Honeycomb" },
  { value: "kagome", label: "Kagome" },
  { value: "bravais", label: "General Bravais" },
];

function FieldLabel({
  htmlFor,
  help,
  children,
}: {
  htmlFor: string;
  help: HelpCopy;
  children: ReactNode;
}) {
  return (
    <div className="field-label-row">
      <label htmlFor={htmlFor}>{children}</label>
      <HelpTooltip copy={help} align="end" />
    </div>
  );
}

export function ParameterPanel() {
  const parameters = useAppStore((state) => state.parameters);
  const setParameter = useAppStore((state) => state.setParameter);
  const setFlux = useAppStore((state) => state.setFlux);
  const setLattice = useAppStore((state) => state.setLattice);
  const [hoppings, setHoppings] = useState(parameters.hoppings.join(", "));
  const [fluxDraft, setFluxDraft] = useState({
    p: String(parameters.p),
    q: String(parameters.q),
  });
  const [editingFlux, setEditingFlux] = useState(false);

  useEffect(() => {
    setHoppings(parameters.hoppings.join(", "));
  }, [parameters.hoppings]);

  useEffect(() => {
    if (editingFlux) return;
    setFluxDraft({
      p: String(parameters.p),
      q: String(parameters.q),
    });
  }, [editingFlux, parameters.p, parameters.q]);


  const commitFluxDraft = () => {
    const parsedQ = Number(fluxDraft.q);
    const q = fluxDraft.q.trim() && Number.isFinite(parsedQ)
      ? Math.max(2, Math.min(199, Math.trunc(parsedQ)))
      : parameters.q;
    const parsedP = Number(fluxDraft.p);
    const p = fluxDraft.p.trim() && Number.isFinite(parsedP)
      ? Math.max(1, Math.min(q - 1, Math.trunc(parsedP)))
      : Math.min(parameters.p, q - 1);
    setFlux(p, q);
    setEditingFlux(false);
  };

  const updateFluxDraft = (key: "p" | "q", value: string) => {
    const nextDraft = { ...fluxDraft, [key]: value };
    setFluxDraft(nextDraft);
    const p = Number(nextDraft.p);
    const q = Number(nextDraft.q);
    if (
      nextDraft.p.trim()
      && nextDraft.q.trim()
      && Number.isInteger(p)
      && Number.isInteger(q)
      && p >= 1
      && q >= 2
      && q <= 199
      && p < q
    ) {
      setFlux(p, q);
    }
  };

  const finishFluxOnEnter = (
    event: KeyboardEvent<HTMLInputElement>,
  ) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    event.currentTarget.blur();
  };

  return (
    <aside className="parameter-panel" aria-label="Scientific parameters">
      <div className="parameter-heading">
        <div className="heading-with-help">
          <span className="eyebrow">MODEL PARAMETERS</span>
          <HelpTooltip copy={parameterHelp.model} />
        </div>
        <span className="auto-badge"><i /> AUTO-RUN</span>
      </div>

      <div className="field">
        <FieldLabel
          htmlFor="parameter-lattice"
          help={parameterHelp.lattice}
        >
          Lattice geometry
        </FieldLabel>
        <select
          id="parameter-lattice"
          value={parameters.lattice}
          onChange={(event) => setLattice(event.target.value as LatticeKind)}
        >
          {lattices.map((lattice) => (
            <option key={lattice.value} value={lattice.value}>
              {lattice.label}
            </option>
          ))}
        </select>
      </div>

      <div className="parameter-section">
        <div className="section-label">
          <div className="heading-with-help">
            <span>Magnetic flux</span>
            <HelpTooltip copy={parameterHelp.flux} />
          </div>
          <output>
            φ = {parameters.p}/{parameters.q}
          </output>
        </div>
        <div
          className="split-fields"
          onFocusCapture={() => setEditingFlux(true)}
          onBlur={(event) => {
            const nextTarget = event.relatedTarget as Node | null;
            if (nextTarget && event.currentTarget.contains(nextTarget)) return;
            commitFluxDraft();
          }}
        >
          <label className="field compact">
            <span>p</span>
            <input
              type="number"
              min="1"
              max={Math.max(
                1,
                (Number(fluxDraft.q) || parameters.q) - 1,
              )}
              value={fluxDraft.p}
              onChange={(event) => updateFluxDraft("p", event.target.value)}
              onKeyDown={finishFluxOnEnter}
            />
          </label>
          <label className="field compact">
            <span>q</span>
            <input
              type="number"
              min="2"
              max="199"
              value={fluxDraft.q}
              onChange={(event) => updateFluxDraft("q", event.target.value)}
              onKeyDown={finishFluxOnEnter}
            />
          </label>
        </div>
        <input
          className="range"
          aria-label="Flux denominator q"
          type="range"
          min="2"
          max="199"
          step="1"
          value={parameters.q}
          onChange={(event) => setParameter("q", Number(event.target.value))}
        />
        <div className="range-labels"><span>2</span><span>199</span></div>
      </div>

      <div className="field">
        <FieldLabel
          htmlFor="parameter-hoppings"
          help={parameterHelp.hoppings}
        >
          Hoppings t₁, t₂, …
        </FieldLabel>
        <input
          id="parameter-hoppings"
          value={hoppings}
          inputMode="decimal"
          onChange={(event) => setHoppings(event.target.value)}
          onBlur={() => {
            const parsed = hoppings
              .split(",")
              .map((entry) => entry.trim())
              .filter((entry) => entry.length > 0)
              .map(Number)
              .filter(Number.isFinite)
              .slice(0, 5);
            if (parsed.length) {
              setParameter("hoppings", parsed);
              setHoppings(parsed.join(", "));
            } else {
              setHoppings(parameters.hoppings.join(", "));
            }
          }}
        />
        <small>
          comma-separated neighbor amplitudes · |tᵢ| ≤{" "}
          {MAX_HOPPING_MAGNITUDE.toLocaleString()}
        </small>
      </div>

      <div className="field">
        <FieldLabel
          htmlFor="parameter-alpha"
          help={parameterHelp.anisotropy}
        >
          Anisotropy α
        </FieldLabel>
        <input
          id="parameter-alpha"
          type="number"
          min="0.1"
          max="4"
          step="0.05"
          value={parameters.alpha}
          disabled={
            parameters.lattice === "square"
            || parameters.lattice === "triangular"
          }
          onChange={(event) => setParameter("alpha", Number(event.target.value))}
        />
      </div>

      <div className="split-fields">
        <div className="field compact">
          <FieldLabel
            htmlFor="parameter-theta-numerator"
            help={parameterHelp.theta}
          >
            θ numerator
          </FieldLabel>
          <input
            id="parameter-theta-numerator"
            type="number"
            min="1"
            max="180"
            value={parameters.theta[0]}
            disabled={
              parameters.lattice !== "bravais"
            }
            onChange={(event) =>
              setParameter("theta", [
                Number(event.target.value),
                parameters.theta[1],
              ])
            }
          />
        </div>
        <div className="field compact">
          <FieldLabel
            htmlFor="parameter-theta-denominator"
            help={parameterHelp.theta}
          >
            θ denominator
          </FieldLabel>
          <input
            id="parameter-theta-denominator"
            type="number"
            min="2"
            max="360"
            value={parameters.theta[1]}
            disabled={
              parameters.lattice !== "bravais"
            }
            onChange={(event) =>
              setParameter("theta", [
                parameters.theta[0],
                Number(event.target.value),
              ])
            }
          />
        </div>
      </div>

      <div className="field">
        <FieldLabel
          htmlFor="parameter-band-gap-threshold"
          help={parameterHelp.bandGapThreshold}
        >
          Band-gap threshold bgt
        </FieldLabel>
        <input
          id="parameter-band-gap-threshold"
          aria-label="Band-gap threshold bgt"
          type="number"
          min="0"
          max="10"
          step="0.001"
          value={parameters.bgt}
          onChange={(event) => setParameter("bgt", Number(event.target.value))}
        />
        <small>touching-band grouping · upstream default 0.01</small>
      </div>

    </aside>
  );
}
