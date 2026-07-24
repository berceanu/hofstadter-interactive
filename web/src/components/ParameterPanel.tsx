import {
  useEffect,
  useState,
  type KeyboardEvent,
} from "react";
import type { LatticeKind } from "../compute/contracts";
import { useAppStore } from "../state/store";

const lattices: { value: LatticeKind; label: string }[] = [
  { value: "square", label: "Square" },
  { value: "triangular", label: "Triangular" },
  { value: "honeycomb", label: "Honeycomb" },
  { value: "kagome", label: "Kagome" },
  { value: "bravais", label: "General Bravais" },
  { value: "custom", label: "Custom basis" },
];

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
  const [customBasis, setCustomBasis] = useState(
    parameters.customBasis.map((point) => point.join(", ")).join("\n"),
  );

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

  useEffect(() => {
    setCustomBasis(
      parameters.customBasis.map((point) => point.join(", ")).join("\n"),
    );
  }, [parameters.customBasis]);

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
        <span className="eyebrow">MODEL PARAMETERS</span>
        <span className="auto-badge"><i /> AUTO-RUN</span>
      </div>

      <label className="field">
        <span>Lattice geometry</span>
        <select
          value={parameters.lattice}
          onChange={(event) => setLattice(event.target.value as LatticeKind)}
        >
          {lattices.map((lattice) => (
            <option key={lattice.value} value={lattice.value}>
              {lattice.label}
            </option>
          ))}
        </select>
      </label>

      <div className="parameter-section">
        <div className="section-label">
          <span>Magnetic flux</span>
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

      <label className="field">
        <span>
          {parameters.lattice === "custom"
            ? "Neighbor-shell hoppings t₁, t₂, …"
            : "Hoppings t₁, t₂, …"}
        </span>
        <input
          value={hoppings}
          inputMode="decimal"
          onChange={(event) => setHoppings(event.target.value)}
          onBlur={() => {
            const parsed = hoppings
              .split(",")
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
        <small>comma-separated neighbor amplitudes</small>
      </label>

      {parameters.lattice === "custom" && (
        <label className="field custom-basis-field">
          <span>Basis sites (fractional a₁, a₂)</span>
          <textarea
            aria-label="Custom basis sites"
            rows={4}
            value={customBasis}
            onChange={(event) => setCustomBasis(event.target.value)}
            onBlur={() => {
              const parsed = customBasis
                .split(/\n|;/)
                .map((entry) => entry.split(",").map(Number))
                .filter(
                  (entry): entry is [number, number] =>
                    entry.length === 2
                    && Number.isFinite(entry[0])
                    && Number.isFinite(entry[1]),
                )
                .slice(0, 4);
              if (parsed.length) {
                setParameter("customBasis", parsed);
              } else {
                setCustomBasis(
                  parameters.customBasis
                    .map((point) => point.join(", "))
                    .join("\n"),
                );
              }
            }}
          />
          <small>
            one x,y pair per line · up to 4 sites · generic upstream solver
          </small>
        </label>
      )}

      <div className="split-fields">
        <label className="field compact">
          <span>Anisotropy α</span>
          <input
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
        </label>
        <label className="field compact">
          <span>Period</span>
          <input
            type="number"
            min="1"
            max="16"
            value={parameters.period}
            onChange={(event) => setParameter("period", Number(event.target.value))}
          />
        </label>
      </div>

      <div className="split-fields">
        <label className="field compact">
          <span>θ numerator</span>
          <input
            type="number"
            min="1"
            max="180"
            value={parameters.theta[0]}
            disabled={
              parameters.lattice !== "bravais"
              && parameters.lattice !== "custom"
            }
            onChange={(event) =>
              setParameter("theta", [
                Number(event.target.value),
                parameters.theta[1],
              ])
            }
          />
        </label>
        <label className="field compact">
          <span>θ denominator</span>
          <input
            type="number"
            min="2"
            max="360"
            value={parameters.theta[1]}
            disabled={
              parameters.lattice !== "bravais"
              && parameters.lattice !== "custom"
            }
            onChange={(event) =>
              setParameter("theta", [
                parameters.theta[0],
                Number(event.target.value),
              ])
            }
          />
        </label>
      </div>

      <div className="parameter-section samples-section">
        <div className="section-label">
          <span>Momentum samples</span>
          <output>{parameters.samples} × {parameters.samples}</output>
        </div>
        <input
          className="range"
          aria-label="Momentum samples per axis"
          type="range"
          min="7"
          max="31"
          step="2"
          value={parameters.samples}
          onChange={(event) => setParameter("samples", Number(event.target.value))}
        />
        <div className="range-labels"><span>faster</span><span>finer</span></div>
        <small
          className="control-help"
          title="The butterfly follows the upstream Γ-point sampling convention."
        >
          Bands only · the butterfly remains Γ-point sampled.
        </small>
      </div>

      <label className="field">
        <span>Band-gap threshold bgt</span>
        <input
          aria-label="Band-gap threshold bgt"
          type="number"
          min="0"
          max="10"
          step="0.001"
          value={parameters.bgt}
          onChange={(event) => setParameter("bgt", Number(event.target.value))}
        />
        <small>touching-band grouping · upstream default 0.01</small>
      </label>

    </aside>
  );
}
