import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { applyDomain, buildDemoData, toErrorData, type DomainMode, type SignalMode } from "@/lib/demoData";
import { XYView, type XYToggles } from "@/components/XYView";
import { TimePlots, type TimeToggles } from "@/components/TimePlots";
import { ResizableColumns } from "@/components/ResizableColumns";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Laser Scan Trajectory Visualizer" },
      { name: "description", content: "Compare commanded, simulated, controller and feedback laser scan trajectories with synchronized XY and time-domain views." },
      { property: "og:title", content: "Laser Scan Trajectory Visualizer" },
      { property: "og:description", content: "High-precision laser scan trajectory comparison tool for engineers." },
    ],
  }),
  component: Index,
});

type Mode2D = DomainMode;

function Index() {
  const data = useMemo(() => buildDemoData(4000, 1e-5), []);

  const [xyToggles, setXyToggles] = useState<XYToggles>({
    pattern: true,
    simulation: true,
    controller: false,
    feedback: true,
    laserHighlight: true,
    zColor: false,
  });

  const [timeToggles, setTimeToggles] = useState<TimeToggles>({
    xPattern: true,
    xSimulation: true,
    xFeedback: true,
    yPattern: true,
    ySimulation: true,
    yFeedback: true,
    zSet: true,
    zFeedback: false,
    laserSwitch: true,
    laserPower: true,
  });

  const [domainMode, setDomainMode] = useState<Mode2D>("combined");
  const [signalMode, setSignalMode] = useState<SignalMode>("absolute");
  const [cursorIdx, setCursorIdx] = useState<number>(530);

  // Domain-filtered dataset: scanner = high-pass residual, stage = lowpass,
  // combined = original. Memoized so it's only recomputed when the mode changes.
  const viewData = useMemo(() => applyDomain(data, domainMode), [data, domainMode]);

  // Time-plot dataset: in "error" mode, each signal is the deviation from the
  // commanded pattern. The XY view always shows absolute coordinates.
  const timeData = useMemo(
    () => (signalMode === "error" ? toErrorData(viewData) : viewData),
    [viewData, signalMode],
  );

  const t = data.t[cursorIdx] ?? 0;

  const effectiveTime: TimeToggles = timeToggles;

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <header className="border-b bg-white px-4 py-2 flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold">Laser Scan Trajectory Visualizer</h1>
        </div>
        <div className="flex items-center gap-4 text-xs">
          <ModeToggle label="Domain" value={domainMode} options={["scanner","stage","combined"] as const} onChange={setDomainMode} />
          <ModeToggle label="Signal" value={signalMode} options={["absolute","error"] as const} onChange={setSignalMode} />
          <div className="font-mono text-zinc-600">t = {(t*1e6).toFixed(1)} µs</div>
        </div>
      </header>

      <div className="h-[calc(100vh-49px)] p-2">
        <ResizableColumns
          storageKey="lst-main-layout-v1"
          defaultFractions={[0.2, 0.45, 0.35]}
          minSizes={[180, 220, 220]}
          left={
            <aside className="flex h-full flex-col gap-3 overflow-auto pr-2">
              <Panel title="2D view — datasets">
                <Check label="Input trajectory (pattern)" color="#111" checked={xyToggles.pattern} onChange={(v)=>setXyToggles(s=>({...s,pattern:v}))} />
                <Check label="Simulation (x,y)" color="#2563eb" checked={xyToggles.simulation} onChange={(v)=>setXyToggles(s=>({...s,simulation:v}))} />
                <Check label="Controller output" color="#16a34a" checked={xyToggles.controller} onChange={(v)=>setXyToggles(s=>({...s,controller:v}))} />
                <Check label="Feedback (measured)" color="#dc2626" checked={xyToggles.feedback} onChange={(v)=>setXyToggles(s=>({...s,feedback:v}))} />
                <div className="my-2 border-t" />
                <Check label="Highlight laser ON" color="#f59e0b" checked={xyToggles.laserHighlight} onChange={(v)=>setXyToggles(s=>({...s,laserHighlight:v}))} />
              </Panel>

              <Panel title="1D plots — signals">
                <SubLabel>X</SubLabel>
                <Check label="x pattern" color="#111" checked={timeToggles.xPattern} onChange={(v)=>setTimeToggles(s=>({...s,xPattern:v}))} />
                <Check label="x simulation" color="#2563eb" checked={timeToggles.xSimulation} onChange={(v)=>setTimeToggles(s=>({...s,xSimulation:v}))} />
                <Check label="x feedback" color="#dc2626" checked={timeToggles.xFeedback} onChange={(v)=>setTimeToggles(s=>({...s,xFeedback:v}))} />
                <SubLabel>Y</SubLabel>
                <Check label="y pattern" color="#111" checked={timeToggles.yPattern} onChange={(v)=>setTimeToggles(s=>({...s,yPattern:v}))} />
                <Check label="y simulation" color="#2563eb" checked={timeToggles.ySimulation} onChange={(v)=>setTimeToggles(s=>({...s,ySimulation:v}))} />
                <Check label="y feedback" color="#dc2626" checked={timeToggles.yFeedback} onChange={(v)=>setTimeToggles(s=>({...s,yFeedback:v}))} />
                <SubLabel>Z</SubLabel>
                <Check label="z set values" color="#111" checked={timeToggles.zSet} onChange={(v)=>setTimeToggles(s=>({...s,zSet:v}))} />
                <Check label="z feedback" color="#dc2626" checked={timeToggles.zFeedback} onChange={(v)=>setTimeToggles(s=>({...s,zFeedback:v}))} />
                <SubLabel>Laser</SubLabel>
                <Check label="laser switching" color="#f59e0b" checked={timeToggles.laserSwitch} onChange={(v)=>setTimeToggles(s=>({...s,laserSwitch:v}))} />
                <Check label="laser power" color="#16a34a" checked={timeToggles.laserPower} onChange={(v)=>setTimeToggles(s=>({...s,laserPower:v}))} />
              </Panel>

              <Panel title="Cursor">
                <input
                  type="range"
                  min={0}
                  max={data.t.length - 1}
                  value={cursorIdx}
                  onChange={(e)=>setCursorIdx(Number(e.target.value))}
                  className="w-full"
                />
                <div className="mt-1 font-mono text-xs">idx {cursorIdx} · t {(t*1e6).toFixed(1)}µs</div>
              </Panel>

              <Panel title="Legend">
                <Legend swatch="#111" label="Pattern (commanded)" />
                <Legend swatch="#2563eb" label="Simulation" />
                <Legend swatch="#16a34a" label="Controller / power" />
                <Legend swatch="#dc2626" label="Feedback / scanner field" />
                <Legend swatch="#f59e0b" label="Laser ON" />
              </Panel>
            </aside>
          }
          middle={
            <section className="h-full min-w-0 min-h-0">
              <XYView data={viewData} toggles={xyToggles} cursorIdx={cursorIdx} onHoverIdx={(i)=>{ if (i!=null) setCursorIdx(i); }} />
            </section>
          }
          right={
            <section className="h-full overflow-auto bg-white border rounded-md p-2">
              <TimePlots data={timeData} toggles={effectiveTime} cursorIdx={cursorIdx} onCursorIdx={setCursorIdx} signalMode={signalMode} />
            </section>
          }
        />
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border bg-white p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-2">{title}</div>
      <div className="flex flex-col gap-1.5">{children}</div>
    </div>
  );
}

function SubLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[10px] font-semibold uppercase text-zinc-400 mt-1">{children}</div>;
}

function Check({ label, color, checked, onChange }: { label: string; color: string; checked: boolean; onChange: (v: boolean)=>void }) {
  return (
    <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
      <input type="checkbox" checked={checked} onChange={(e)=>onChange(e.target.checked)} />
      <span className="inline-block h-2 w-3 rounded-sm" style={{ backgroundColor: color }} />
      <span>{label}</span>
    </label>
  );
}

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="inline-block h-2 w-3 rounded-sm" style={{ backgroundColor: swatch }} />
      <span>{label}</span>
    </div>
  );
}

function ModeToggle<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly T[]; onChange: (v: T)=>void }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-zinc-500">{label}:</span>
      <div className="inline-flex rounded-md border overflow-hidden">
        {options.map((o)=>(
          <button
            key={o}
            onClick={()=>onChange(o)}
            className={`px-2 py-1 text-xs ${value===o ? "bg-zinc-900 text-white" : "bg-white hover:bg-zinc-50"}`}
          >{o}</button>
        ))}
      </div>
    </div>
  );
}
