import { useState } from "react";
import type { LatticeKind } from "../compute/contracts";
import { useAppStore } from "../state/store";

const lattices: { value: LatticeKind; label: string }[] = [
  { value: "square", label: "Square" },
  { value: "triangular", label: "Triangular" },
  { value: "honeycomb", label: "Honeycomb" },
  { value: "kagome", label: "Kagome" },
  { value: "bravais", label: "General Bravais" },
];

export function ParameterPanel() {
  const parameters = useAppStore((state) => state.parameters);
  const setParameter = useAppStore((state) => state.setParameter);
  const setLattice = useAppStore((state) => state.setLattice);
  const [hoppings, setHoppings] = useState(parameters.hoppings.join(", "));

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
        <div className="split-fields">
          <label className="field compact">
            <span>p</span>
            <input
              type="number"
              min="1"
              max={parameters.q - 1}
              value={parameters.p}
              onChange={(event) =>
                setParameter(
                  "p",
                  Math.max(1, Math.min(parameters.q - 1, Number(event.target.value))),
                )
              }
            />
          </label>
          <label className="field compact">
            <span>q</span>
            <input
              type="number"
              min="3"
              max="199"
              value={parameters.q}
              onChange={(event) =>
                setParameter(
                  "q",
                  Math.max(3, Math.min(199, Number(event.target.value))),
                )
              }
            />
          </label>
        </div>
        <input
          className="range"
          aria-label="Flux denominator q"
          type="range"
          min="3"
          max="97"
          step="2"
          value={Math.min(97, parameters.q)}
          onChange={(event) => setParameter("q", Number(event.target.value))}
        />
        <div className="range-labels"><span>3</span><span>97</span></div>
      </div>

      <label className="field">
        <span>Hoppings t₁, t₂, …</span>
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

      <div className="split-fields">
        <label className="field compact">
          <span>Anisotropy α</span>
          <input
            type="number"
            min="0.1"
            max="4"
            step="0.05"
            value={parameters.alpha}
            disabled={parameters.lattice === "square" || parameters.lattice === "triangular"}
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
            disabled={parameters.lattice !== "bravais"}
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
            min="1"
            max="360"
            value={parameters.theta[1]}
            disabled={parameters.lattice !== "bravais"}
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
      </div>

      <div className="local-note">
        <span aria-hidden="true">⌁</span>
        <div>
          <strong>Private by construction</strong>
          <p>Every eigensolve runs in this browser. No parameters or data leave your device.</p>
        </div>
      </div>
    </aside>
  );
}
