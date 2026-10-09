import { useCallback, useEffect, useState } from "react";
import {
  Accessibility,
  Activity,
  ArrowRight,
  BookOpen,
  BriefcaseBusiness,
  Check,
  ChevronRight,
  ClipboardCheck,
  Database,
  Eye,
  EyeOff,
  FileText,
  LayoutDashboard,
  Menu,
  MessageSquareText,
  RefreshCw,
  Save,
  Send,
  ShieldCheck,
  Sparkles,
  UserCheck,
  UserPlus,
  Users,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import QRCode from "qrcode";
import { api, writeApi } from "./api";
import { clientDb, flushOutbox } from "./db";
import type {
  Bootstrap,
  CandidateDetail,
  CandidateSummary,
  Criterion,
  Draft,
} from "./types";
import {
  CandidatePhoneFlow,
  DatabaseManager,
  JobSetup,
  MatchReview,
  RecruiterViewpoint,
} from "./Workflow";

type View =
  | "dashboard"
  | "jobs"
  | "candidateFlow"
  | "recruiter"
  | "matches"
  | "database"
  | "card"
  | "spill"
  | "manager"
  | "intake"
  | "audit";

const labels: Record<string, string> = {
  MET: "Confirmed",
  NOT_MET: "Does not meet",
  UNKNOWN: "Unknown",
  NEEDS_REVIEW: "Needs review",
  DECLINED: "Not provided",
  not_addressed: "Not yet discussed",
  claimed: "Mentioned",
  described: "Explained with an example",
  corroborated: "Confirmed two ways",
  deferred: "Asked in interview",
};

function StatePill({ state }: { state: string }) {
  return (
    <span className={`state state-${state.toLowerCase().replaceAll("_", "-")}`}>
      {labels[state] || state}
    </span>
  );
}

function Logo() {
  return (
    <div className="logo">
      <span className="logo-mark brand-logo-shell"><img src="/barry-emblem.png" alt="Barry geometric bee logo" /></span>
      <span>
        <strong>Barry<span className="brand-period">.</span></strong>
        <small>Career-fair evidence</small>
      </span>
    </div>
  );
}

const navItems: { id: View; label: string; icon: any; group: string; helper: string }[] = [
  { id: "dashboard", label: "Overview", icon: LayoutDashboard, group: "Workspace", helper: "Fair status and next actions" },
  { id: "jobs", label: "Job setup", icon: BriefcaseBusiness, group: "Prepare", helper: "Define role requirements" },
  { id: "candidateFlow", label: "Candidate check-in", icon: UserPlus, group: "Live fair", helper: "Resume, gaps, and QR" },
  { id: "recruiter", label: "Recruiter viewpoint", icon: UserCheck, group: "Live fair", helper: "Capture the conversation" },
  { id: "matches", label: "Matches & shortlist", icon: ClipboardCheck, group: "Review", helper: "Compare jobs and decide" },
  { id: "database", label: "Database", icon: Database, group: "Manage", helper: "Candidates and open jobs" },
  { id: "audit", label: "Audit trail", icon: Activity, group: "Manage", helper: "Review record history" },
];

const candidateViews = new Set<View>([
  "dashboard",
  "recruiter",
  "matches",
  "card",
  "spill",
  "manager",
  "audit",
]);

const workflowSteps: { id: View; number: string; label: string; short: string; icon: any }[] = [
  { id: "jobs", number: "01", label: "Define jobs", short: "Job criteria", icon: BriefcaseBusiness },
  { id: "candidateFlow", number: "02", label: "Confirm facts", short: "Candidate intake", icon: UserPlus },
  { id: "recruiter", number: "03", label: "Capture evidence", short: "Conversation", icon: MessageSquareText },
  { id: "matches", number: "04", label: "Compare jobs", short: "Job fit", icon: ClipboardCheck },
  { id: "database", number: "05", label: "Review records", short: "Database", icon: Database },
];

const validViews = new Set<View>(navItems.map((item) => item.id));

function App() {
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [candidate, setCandidate] = useState<CandidateDetail | null>(null);
  const [matching, setMatching] = useState<any>(null);
  const query = new URLSearchParams(window.location.search);
  const [selectedId, setSelectedId] = useState(query.get("candidate") || "");
  const requestedView = query.get("view") as View | null;
  const [view, setView] = useState<View>(requestedView && validViews.has(requestedView) ? requestedView : "dashboard");
  const [menuOpen, setMenuOpen] = useState(false);
  const [pending, setPending] = useState(0);
  const [online, setOnline] = useState(navigator.onLine);
  const [error, setError] = useState("");
  const [readingMode, setReadingMode] = useState(() => localStorage.getItem("talentiq-reading-mode") === "true");
  const [recruiterId, setRecruiterId] = useState(() => localStorage.getItem("talentiq-recruiter-id") || "rec-live");

  const loadBootstrap = useCallback(async () => {
    const data = await api<Bootstrap>("/bootstrap");
    setBootstrap(data);
    setMatching(data.matching);
    let id = selectedId || data.hero_candidate_id;
    try {
      setCandidate(await api<CandidateDetail>(`/candidates/${id}?recruiter=${encodeURIComponent(recruiterId)}`));
    } catch {
      id = data.candidates[0]?.candidate_id || data.hero_candidate_id;
      setCandidate(await api<CandidateDetail>(`/candidates/${id}?recruiter=${encodeURIComponent(recruiterId)}`));
    }
    setSelectedId(id);
  }, [selectedId, recruiterId]);

  const loadCandidate = useCallback(async (id: string) => {
    setSelectedId(id);
    setCandidate(await api<CandidateDetail>(`/candidates/${id}?recruiter=${encodeURIComponent(recruiterId)}`));
    const url = new URL(window.location.href);
    url.searchParams.set("candidate", id);
    if (view === "recruiter") url.searchParams.set("view", "recruiter");
    history.replaceState(null, "", url);
  }, [view, recruiterId]);

  const changeRecruiter = useCallback(async (id: string) => {
    const normalized = id.trim() || "rec-live";
    setRecruiterId(normalized);
    localStorage.setItem("talentiq-recruiter-id", normalized);
    if (selectedId) setCandidate(await api<CandidateDetail>(`/candidates/${selectedId}?recruiter=${encodeURIComponent(normalized)}`));
  }, [selectedId]);

  const refreshMatching = useCallback(async () => {
    setMatching(await api("/matching/setup"));
  }, []);

  useEffect(() => {
    loadBootstrap().catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (view === "dashboard") url.searchParams.delete("view");
    else url.searchParams.set("view", view);
    history.replaceState(null, "", url);
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [view]);
  useEffect(() => {
    document.body.classList.toggle("dyslexia-friendly", readingMode);
    localStorage.setItem("talentiq-reading-mode", String(readingMode));
  }, [readingMode]);
  useEffect(() => {
    const update = async () => {
      setOnline(navigator.onLine);
      if (navigator.onLine) await flushOutbox();
      setPending(await clientDb.outbox.count());
    };
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    update();
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const criteria = bootstrap?.criteria || [];
  const jobs = bootstrap?.jobs || [];
  const currentJobId = candidate?.roles_of_interest[0] || jobs[0]?.job_id;

  async function reset() {
    if (
      !confirm(
        "Reset the local demo database to its original fictional records?",
      )
    )
      return;
    await api("/reset", { method: "POST" });
    await loadBootstrap();
  }

  if (!bootstrap || !candidate || !matching)
    return (
      <div className="loading">
        <div className="spinner" />
        <Logo />
        <p>Preparing the evidence workspace…</p>
        {error && <p className="error">{error}</p>}
      </div>
    );

  return (
    <div className="app-shell">
      <aside className={menuOpen ? "sidebar open" : "sidebar"}>
        <Logo />
        <span className="nav-kicker">Recruiter workspace</span>
        <button
          className="close-menu"
          onClick={() => setMenuOpen(false)}
          aria-label="Close navigation"
        >
          <X />
        </button>
        <nav>
          {["Workspace", "Prepare", "Live fair", "Review", "Manage"].map((group) => (
            <div className="nav-group" key={group}>
              <span className="nav-group-label">{group}</span>
              {navItems.filter((item) => item.group === group).map((item) => (
                <button
                  key={item.id}
                  className={view === item.id ? "nav-item active" : "nav-item"}
                  onClick={() => {
                    setView(item.id);
                    setMenuOpen(false);
                  }}
                >
                  <item.icon size={18} />
                  <span>{item.label}</span>
                  {view === item.id && <ChevronRight size={15} />}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className={online ? "connection online" : "connection"}>
            {online ? <Wifi size={15} /> : <WifiOff size={15} />}{" "}
            {online ? "Online" : "Working offline"}
          </div>
          <button className="text-button" onClick={reset}>
            <RefreshCw size={15} /> Reset demo data
          </button>
          <small>
            {pending} change{pending === 1 ? "" : "s"} waiting to sync
          </small>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div className="mobile-brandbar">
            <button
              className="menu-button"
              onClick={() => setMenuOpen(true)}
              aria-label="Open navigation"
            >
              <Menu />
            </button>
            <Logo />
            <span className="mobile-live"><i /> LIVE</span>
          </div>
          <div className="topbar-title">
            <span className="eyebrow">Barry · Live workspace</span>
            <h1>{navItems.find((n) => n.id === view)?.label}</h1>
            <p>{navItems.find((n) => n.id === view)?.helper || "Candidate evidence workspace"}</p>
          </div>
          <button className="database-live" onClick={() => setView("database")} title="Open database records">
            <span />
            <b>{bootstrap.database.engine}</b>
            <small>{bootstrap.database.connected ? "connected" : "needs attention"}</small>
          </button>
          <button
            className={readingMode ? "accessibility-toggle active" : "accessibility-toggle"}
            onClick={() => setReadingMode((value) => !value)}
            aria-pressed={readingMode}
            title="Toggle dyslexia-friendly reading mode"
          >
            <Accessibility />
            <span>Reading mode</span>
          </button>
          {candidateViews.has(view) && (
            <CandidatePicker
              candidates={bootstrap.candidates}
              selectedId={selectedId}
              onChange={loadCandidate}
            />
          )}
        </header>
        {view !== "audit" && (
          <WorkflowRail
            view={view}
            onSelect={setView}
            jobCount={jobs.length}
            candidateCount={bootstrap.candidates.length}
          />
        )}
        {error && (
          <div className="toast error">
            <X size={16} />
            {error}
            <button onClick={() => setError("")}>Dismiss</button>
          </div>
        )}
        <section className="page">
          {view === "dashboard" && (
            <Dashboard
              bootstrap={bootstrap}
              candidate={candidate}
              jobs={jobs}
              setView={setView}
            />
          )}
          {view === "jobs" && (
            <JobSetup setup={matching} onRefresh={loadBootstrap} />
          )}
          {view === "candidateFlow" && (
            <CandidatePhoneFlow
              onViewDatabase={() => setView("database")}
              onCreated={async (id) => {
                await loadBootstrap();
                await loadCandidate(id);
              }}
            />
          )}
          {view === "recruiter" && (
            <RecruiterViewpoint
              candidate={candidate}
              setup={matching}
              recruiterId={recruiterId}
              onRecruiterChange={changeRecruiter}
              onScan={loadCandidate}
              onSaved={() => loadCandidate(candidate.candidate_id)}
            />
          )}
          {view === "matches" && <MatchReview setup={matching} candidateId={selectedId} onCandidateChange={loadCandidate} />}
          {view === "database" && <DatabaseManager onChanged={loadBootstrap} />}
          {view === "card" && (
            <RecruiterCard
              candidate={candidate}
              criteria={criteria}
              jobs={jobs}
            />
          )}
          {view === "spill" && (
            <Spill
              candidate={candidate}
              onChanged={() => loadCandidate(candidate.candidate_id)}
              onError={setError}
            />
          )}
          {view === "manager" && (
            <ManagerView
              candidate={candidate}
              criteria={criteria}
              jobs={jobs}
              onChanged={() => loadCandidate(candidate.candidate_id)}
              onError={setError}
            />
          )}
          {view === "intake" && (
            <Intake
              jobs={jobs}
              onCreated={async (id) => {
                await loadBootstrap();
                await loadCandidate(id);
                setView("card");
              }}
            />
          )}
          {view === "audit" && <Audit candidate={candidate} />}
        </section>
      </main>
    </div>
  );
}

function WorkflowRail({
  view,
  onSelect,
  jobCount,
  candidateCount,
}: {
  view: View;
  onSelect: (view: View) => void;
  jobCount: number;
  candidateCount: number;
}) {
  const activeIndex = workflowSteps.findIndex((step) => step.id === view);
  return (
    <div className="workflow-rail-wrap" aria-label="Barry workflow">
      <div className="workflow-rail">
        <div className="flow-rail-label">
          <Database />
          <span>
            <strong>Workflow</strong>
            <small>One record across every step</small>
          </span>
        </div>
        {workflowSteps.map((step, index) => {
          const Icon = step.icon;
          const active = step.id === view;
          const visited = activeIndex > index;
          const meta = step.short;
          return (
            <button
              className={active ? "flow-step active" : visited ? "flow-step visited" : "flow-step"}
              key={step.id}
              onClick={() => onSelect(step.id)}
              aria-current={active ? "step" : undefined}
            >
              <span className="flow-step-icon">{visited ? <Check /> : <Icon />}</span>
              <span>
                <small>{step.number} · {meta}</small>
                <strong>{step.label}</strong>
              </span>
              {index < workflowSteps.length - 1 && <ArrowRight className="flow-arrow" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CandidatePicker({
  candidates,
  selectedId,
  onChange,
}: {
  candidates: CandidateSummary[];
  selectedId: string;
  onChange: (id: string) => void;
}) {
  return (
    <label className="candidate-picker">
      <span>Current candidate · {candidates.length} records</span>
      <select value={selectedId} onChange={(e) => onChange(e.target.value)}>
        {candidates.map((c) => (
          <option value={c.candidate_id} key={c.candidate_id}>
            {c.short_code} · {c.full_name}
          </option>
        ))}
      </select>
    </label>
  );
}

function Dashboard({
  bootstrap,
  candidate,
  jobs,
  setView,
}: {
  bootstrap: Bootstrap;
  candidate: CandidateDetail;
  jobs: any[];
  setView: (v: View) => void;
}) {
  const stateValues = Object.values(candidate.states_by_job).flatMap(
    (j) => j.states,
  );
  const explained = stateValues.filter((s) =>
    ["described", "corroborated"].includes(s.state),
  ).length;
  const unknownCount = stateValues.filter((s) =>
    ["UNKNOWN", "NEEDS_REVIEW", "not_addressed"].includes(s.state),
  ).length;
  const demoSteps = [
    { ...workflowSteps[0], description: "Create or inspect a job and its factual requirements.", result: `${bootstrap.database.counts.jobs} open jobs` },
    { ...workflowSteps[1], description: "Upload a résumé, answer only its gaps, and generate a QR.", result: `${bootstrap.database.counts.candidates} candidate records` },
    { ...workflowSteps[2], description: "Open a candidate, capture notes, and save recruiter inputs.", result: `${bootstrap.database.counts.recruiter_ratings} saved ratings` },
    { ...workflowSteps[3], description: "Inspect the job comparison and record a human decision.", result: `${bootstrap.database.counts.match_results} comparisons` },
    { ...workflowSteps[4], description: "See the rows that were persisted and manage demo records.", result: `${bootstrap.database.counts.audit_events} audit events` },
  ];
  return (
    <>
      <div className="hero-panel">
        <div className="hero-copy">
          <div className="hero-live-row">
            <span className="hall-status"><i /> LIVE · HALL B</span>
            <span className="scan-status">
              <b>● SCANNED {candidate.arrival_time || "NOW"}</b>
              <strong>{candidate.short_code} · {candidate.full_name}</strong>
              <small>{candidate.evidence.length} evidence · {unknownCount} unknown</small>
            </span>
            <span className="spill-status">
              <b>◆ SPILL CAPTURED</b>
              <strong>{candidate.spill_notes.length ? `${candidate.spill_notes.length} saved note${candidate.spill_notes.length === 1 ? "" : "s"}` : "Ready to record"}</strong>
            </span>
          </div>
          <span className="eyebrow light">Career-fair continuity</span>
          <h2>
            Carry the evidence forward.
            <span> Leave the impressions behind.</span>
          </h2>
          <p>
            Barry turns a short booth conversation into a reviewable record
            with exact sources, open questions, and human approval.
          </p>
          <div className="hero-actions">
            <button className="button light" onClick={() => setView("candidateFlow")}>
              Run the full demo <ArrowRight size={17} />
            </button>
            <button className="button ghost-light" onClick={() => document.getElementById("simulation-launcher")?.scrollIntoView({ behavior: "smooth" })}>
              Choose a step
            </button>
          </div>
          <span className="hero-photo-credit">
            Real recruitment-table photo: Marc A. Hermann / Metropolitan Transportation Authority ·{" "}
            <a href="https://commons.wikimedia.org/wiki/File:EWT_Career_Fair_(53585232212).jpg" target="_blank" rel="noreferrer">source</a>
            {" · "}
            <a href="https://creativecommons.org/licenses/by/2.0/" target="_blank" rel="noreferrer">CC BY 2.0</a>
          </span>
        </div>
      </div>
      <div className="metrics">
        <Metric
          icon={Users}
          value={bootstrap.candidates.length}
          label="Fictional demo records"
        />
        <Metric
          icon={BriefcaseBusiness}
          value={bootstrap.matching.jobs.length}
          label="Open jobs"
        />
        <Metric icon={Check} value={explained} label="Examples explained" />
        <Metric icon={Database} value={bootstrap.database.connected ? "Live" : "Check"} label={`${bootstrap.database.engine} database`} />
      </div>
      <section className="simulation-launcher" id="simulation-launcher">
        <div className="simulation-heading">
          <div>
            <span className="eyebrow">Demo workflow</span>
            <h2>Choose a step.</h2>
            <p>Each screen uses the same live SQL record.</p>
          </div>
          <div className={bootstrap.database.connected ? "db-proof connected" : "db-proof"}>
            <Database />
            <span>
              <strong>{bootstrap.database.connected ? "Backend connected" : "Database issue"}</strong>
              <small>{bootstrap.database.schema_tables}/{bootstrap.database.required_tables} tables · {bootstrap.database.journal_mode} mode · foreign keys {bootstrap.database.foreign_keys ? "on" : "off"}</small>
            </span>
          </div>
        </div>
        <div className="simulation-grid">
          {demoSteps.map((step) => {
            const Icon = step.icon;
            return (
              <button className="simulation-card" key={step.id} onClick={() => setView(step.id)}>
                <span className="simulation-number">{step.number}</span>
                <span className="simulation-icon"><Icon /></span>
                <span className="simulation-copy">
                  <strong>{step.label}</strong>
                  <small>{step.description}</small>
                </span>
                <span className="simulation-result"><i />{step.result}</span>
                <span className="simulation-cta">Open <ArrowRight /></span>
              </button>
            );
          })}
        </div>
      </section>
      <div className="two-column dashboard-lower">
        <div className="panel current-record-panel">
          <div className="panel-heading">
            <div><span className="eyebrow">Current demo record</span><h3>{candidate.full_name}</h3></div>
            <span className="code">{candidate.short_code}</span>
          </div>
          <p className="muted">Use this seeded candidate to jump directly into the recruiter experience.</p>
          <div className="record-actions">
            <button className="button" onClick={() => setView("recruiter")}>Open recruiter viewpoint <ChevronRight size={17} /></button>
            <button className="button secondary" onClick={() => setView("matches")}>Review saved outcome</button>
          </div>
        </div>
        <div className="panel data-journey">
          <span className="eyebrow">What is persisted</span>
          <div><b>1</b><span><strong>Candidate facts</strong><small>Résumé extraction and confirmed gap answers</small></span></div>
          <div><b>2</b><span><strong>Recruiter evidence</strong><small>Ratings, baseline checks, preferences, and Spill notes</small></span></div>
          <div><b>3</b><span><strong>Human outcomes</strong><small>Review decisions plus an append-only audit trail</small></span></div>
        </div>
      </div>
    </>
  );
}

function Metric({
  icon: Icon,
  value,
  label,
}: {
  icon: any;
  value: string | number;
  label: string;
}) {
  return (
    <div className="metric">
      <Icon />
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function RecruiterCard({
  candidate,
  criteria,
  jobs,
}: {
  candidate: CandidateDetail;
  criteria: Criterion[];
  jobs: any[];
}) {
  const jobId = candidate.roles_of_interest[0];
  const stateSet = candidate.states_by_job[jobId];
  const jobCriteria = criteria.filter((c) => c.job_id === jobId);
  const covered = stateSet.states.filter((s) =>
    ["MET", "described", "corroborated"].includes(s.state),
  );
  return (
    <div className="record-layout">
      <section className="record-main">
        <div className="record-title">
          <div>
            <span className="eyebrow">
              {jobs.find((j) => j.job_id === jobId)?.title}
            </span>
            <h2>{candidate.full_name}</h2>
            <p>
              {candidate.short_code} · arrived{" "}
              {new Date(candidate.arrival_time).toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
              })}
            </p>
          </div>
          <div className="notice">
            <ShieldCheck />
            <span>
              Career-fair conversation
              <br />
              <strong>Not an interview</strong>
            </span>
          </div>
        </div>
        <div className="section-heading">
          <h3>Already covered</h3>
          <span>{covered.length} requirement areas</span>
        </div>
        <div className="criterion-grid">
          {covered.map((s) => (
            <CriterionCard
              key={s.criterion_id}
              state={s.state}
              criterion={
                jobCriteria.find((c) => c.criterion_id === s.criterion_id)!
              }
              evidence={candidate.evidence.filter((e) =>
                s.basis_ids.includes(e.evidence_id),
              )}
            />
          ))}
        </div>
      </section>
      <aside className="explore">
        <span className="eyebrow light">Use the four minutes well</span>
        <h3>Explore next</h3>
        {stateSet.explore_next.map((q, i) => (
          <div className="question" key={q.criterion_id}>
            <span>0{i + 1}</span>
            <StatePill state={q.state} />
            <p>{q.question}</p>
          </div>
        ))}
      </aside>
    </div>
  );
}

function CriterionCard({
  criterion,
  state,
  evidence,
}: {
  criterion: Criterion;
  state: string;
  evidence: any[];
}) {
  return (
    <article className="criterion-card">
      <div>
        <span className="criterion-kind">{criterion.priority}</span>
        <StatePill state={state} />
      </div>
      <h4>{criterion.label}</h4>
      {evidence.slice(0, 2).map((e) => (
        <blockquote key={e.evidence_id}>
          “{e.quote}”<cite>{e.source_kind.replaceAll("_", " ")}</cite>
        </blockquote>
      ))}
    </article>
  );
}

function Spill({
  candidate,
  onChanged,
  onError,
}: {
  candidate: CandidateDetail;
  onChanged: () => void;
  onError: (s: string) => void;
}) {
  const [text, setText] = useState(
    "She said she built the login flow and wrote the unit tests; a teammate did the UI. Seemed super confident.",
  );
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [prompts, setPrompts] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [ann, setAnn] = useState("");
  async function extract() {
    setBusy(true);
    try {
      const r = await api<any>("/extract/debrief", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          candidate_id: candidate.candidate_id,
          text,
          demo_mode: true,
        }),
      });
      setDrafts(r.kept);
      setPrompts(r.prompts);
      setAnn(`${r.kept.length} evidence drafts ready for review`);
    } catch (e: any) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function approve(draft: Draft, index: number) {
    try {
      const r = await writeApi<any>("/evidence", "evidence", {
        candidate_id: candidate.candidate_id,
        item: draft,
        source_text: text,
        drafted_by: "ai:deterministic-demo@debrief-v1",
      });
      setDrafts((x) => x.filter((_, i) => i !== index));
      if (r) onChanged();
    } catch (e: any) {
      onError(e.message);
    }
  }
  return (
    <div className="spill-layout">
      <div className="panel">
        <span className="eyebrow">The Spill</span>
        <h2>What did they describe doing?</h2>
        <div className="prompt-chips">
          <span>Their work</span>
          <span>Their part</span>
          <span>What was new</span>
          <span>What is unclear</span>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
          aria-label="Recruiter debrief"
        />
        <div className="form-actions">
          <p>
            <Sparkles size={16} /> Exact quotes are checked before display.
          </p>
          <button className="button" onClick={extract} disabled={busy}>
            {busy ? <RefreshCw className="spin" /> : <Sparkles />} Organize
            notes
          </button>
        </div>
      </div>
      <div className="draft-column">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Human approval</span>
            <h3>Draft evidence</h3>
          </div>
          <span>{drafts.length} waiting</span>
        </div>
        <div aria-live="polite" className="sr-only">
          {ann}
        </div>
        {!drafts.length && (
          <div className="empty">
            <BookOpen />
            <h4>No drafts waiting</h4>
            <p>
              Organize the debrief, then approve only what the candidate
              actually described.
            </p>
          </div>
        )}
        {drafts.map((d, i) => (
          <article className="draft" key={`${d.quote}-${i}`}>
            <div>
              <StatePill state={d.strength} />
              <span className="ownership">{d.ownership}</span>
            </div>
            <p>{d.statement}</p>
            <blockquote>“{d.quote}”</blockquote>
            <div className="draft-actions">
              <button className="button small" onClick={() => approve(d, i)}>
                <Check /> Approve
              </button>
              <button
                className="button secondary small"
                onClick={() => setDrafts((x) => x.filter((_, n) => n !== i))}
              >
                <X /> Reject
              </button>
            </div>
          </article>
        ))}
        {prompts.map((p) => (
          <div className="impression-prompt" key={p.term}>
            <EyeOff />
            <div>
              <strong>Not saved as evidence</strong>
              <p>
                “{p.term}” describes an impression. {p.prompt}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ManagerView({
  candidate,
  criteria,
  jobs,
  onChanged,
  onError,
}: {
  candidate: CandidateDetail;
  criteria: Criterion[];
  jobs: any[];
  onChanged: () => void;
  onError: (s: string) => void;
}) {
  const [blind, setBlind] = useState(true);
  const [choice, setChoice] = useState("follow_up");
  const [rationale, setRationale] = useState("");
  const jobId = candidate.roles_of_interest[0];
  const stateSet = candidate.states_by_job[jobId];
  const jobCriteria = criteria.filter((c) => c.job_id === jobId);
  async function save() {
    try {
      await writeApi("/decisions", "decision", {
        candidate_id: candidate.candidate_id,
        job_id: jobId,
        decision: choice,
        rationale,
      });
      setRationale("");
      onChanged();
    } catch (e: any) {
      onError(e.message);
    }
  }
  return (
    <div className="manager-page">
      <div className="manager-banner">
        <div>
          <ShieldCheck />
          <span>
            Career-fair conversation, about four minutes—not an interview.
          </span>
        </div>
        <button className="toggle" onClick={() => setBlind(!blind)}>
          {blind ? <EyeOff /> : <Eye />} Blind mode {blind ? "on" : "off"}
        </button>
      </div>
      <div className="record-title">
        <div>
          <span className="eyebrow">
            {jobs.find((j) => j.job_id === jobId)?.title}
          </span>
          <h2>{blind ? candidate.short_code : candidate.full_name}</h2>
          {!blind && (
            <p>
              {candidate.email} · {candidate.school}
            </p>
          )}
        </div>
      </div>
      <div className="manager-grid">
        <div className="requirements">
          {stateSet.states.map((s) => {
            const c = jobCriteria.find(
              (x) => x.criterion_id === s.criterion_id,
            )!;
            const ev = candidate.evidence.filter((e) =>
              s.basis_ids.includes(e.evidence_id),
            );
            return (
              <article className="requirement-row" key={s.criterion_id}>
                <div>
                  <StatePill state={s.state} />
                  <h4>{c.label}</h4>
                  <span>{c.priority}</span>
                </div>
                {ev.length ? (
                  <div className="evidence-list">
                    {ev.map((e) => (
                      <details key={e.evidence_id}>
                        <summary>{e.statement}</summary>
                        <mark>{e.quote}</mark>
                        <small>{e.source_kind.replaceAll("_", " ")}</small>
                      </details>
                    ))}
                  </div>
                ) : (
                  <p className="muted">
                    No approved evidence recorded.{" "}
                    {c.suggested_question && (
                      <em>Ask: {c.suggested_question}</em>
                    )}
                  </p>
                )}
              </article>
            );
          })}
        </div>
        <aside className="decision-box">
          <span className="eyebrow">Human decision</span>
          <h3>Record the next step</h3>
          <label>
            Decision
            <select value={choice} onChange={(e) => setChoice(e.target.value)}>
              <option value="advance">Advance</option>
              <option value="follow_up">Follow-up</option>
              <option value="not_moving_forward">Not moving forward</option>
            </select>
          </label>
          <label>
            Required rationale
            <textarea
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              rows={6}
              placeholder="Name the evidence or open requirement that drove this decision."
            />
          </label>
          <button
            className="button"
            onClick={save}
            disabled={!rationale.trim()}
          >
            <Save /> Save decision
          </button>
        </aside>
      </div>
    </div>
  );
}

function Intake({
  jobs,
  onCreated,
}: {
  jobs: any[];
  onCreated: (id: string) => void;
}) {
  const [form, setForm] = useState({
    full_name: "",
    email: "",
    phone: "",
    degree_field: "",
    expected_grad: "",
    resume_text: "",
    roles_of_interest: [jobs[0]?.job_id].filter(Boolean),
  });
  const [result, setResult] = useState<any>(null);
  const [qr, setQr] = useState("");
  const update = (key: string, value: any) =>
    setForm((x) => ({ ...x, [key]: value }));
  async function submit(e: any) {
    e.preventDefault();
    const payload = {
      ...form,
      confirmed_facts: {
        degree_field: form.degree_field,
        expected_grad: form.expected_grad,
      },
    };
    const r = await api<any>("/intake", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    setResult(r);
    setQr(
      await QRCode.toDataURL(
        JSON.stringify({
          candidate_id: r.candidate_id,
          name: form.full_name,
          email: form.email,
          job_ids: form.roles_of_interest,
          degree_field: form.degree_field,
          expected_grad: form.expected_grad,
        }),
        { width: 280, margin: 1, color: { dark: "#123D32", light: "#FFFFFF" } },
      ),
    );
  }
  if (result)
    return (
      <div className="success-card">
        <Check />
        <span className="eyebrow">Intake complete</span>
        <h2>{result.short_code}</h2>
        <p>Your confirmed record is ready for the recruiter.</p>
        <img src={qr} alt="Candidate record QR code" />
        {result.duplicate_suggestion && (
          <div className="warning">
            A similar email already exists. A person must review the possible
            duplicate.
          </div>
        )}
        <button
          className="button"
          onClick={() => onCreated(result.candidate_id)}
        >
          Open recruiter card
        </button>
      </div>
    );
  return (
    <form className="intake-form panel" onSubmit={submit}>
      <span className="eyebrow">Candidate phone</span>
      <h2>Start your career-fair record</h2>
      <p className="muted">
        AI helps organize recruiter notes. People make every decision.
      </p>
      <div className="form-grid">
        <label>
          Full name
          <input
            required
            value={form.full_name}
            onChange={(e) => update("full_name", e.target.value)}
          />
        </label>
        <label>
          Email
          <input
            required
            type="email"
            value={form.email}
            onChange={(e) => update("email", e.target.value)}
          />
        </label>
        <label>
          Phone <span>optional</span>
          <input
            value={form.phone}
            onChange={(e) => update("phone", e.target.value)}
          />
        </label>
        <label>
          Degree field
          <input
            value={form.degree_field}
            onChange={(e) => update("degree_field", e.target.value)}
          />
        </label>
        <label>
          Expected graduation
          <input
            type="month"
            value={form.expected_grad}
            onChange={(e) => update("expected_grad", e.target.value)}
          />
        </label>
        <fieldset>
          <legend>Roles of interest</legend>
          {jobs.map((j) => (
            <label className="check" key={j.job_id}>
              <input
                type="checkbox"
                checked={form.roles_of_interest.includes(j.job_id)}
                onChange={(e) =>
                  update(
                    "roles_of_interest",
                    e.target.checked
                      ? [...form.roles_of_interest, j.job_id]
                      : form.roles_of_interest.filter((x) => x !== j.job_id),
                  )
                }
              />
              {j.title}
            </label>
          ))}
        </fieldset>
      </div>
      <label>
        Paste résumé text
        <textarea
          rows={8}
          value={form.resume_text}
          onChange={(e) => update("resume_text", e.target.value)}
          placeholder="Paste the résumé text here. You will confirm every extracted fact before it is used."
        />
      </label>
      <button className="button" type="submit">
        Confirm and create record <ArrowRight />
      </button>
    </form>
  );
}

function Study({
  lists,
  criteria,
}: {
  lists: string[];
  criteria: Criterion[];
}) {
  const [listId, setListId] = useState(lists[0]);
  const [participant, setParticipant] = useState("R01");
  const [cases, setCases] = useState<any[]>([]);
  const [index, setIndex] = useState(0);
  const [started, setStarted] = useState(0);
  const [responses, setResponses] = useState<any[]>([]);
  const [form, setForm] = useState({
    decision: "follow_up",
    rationale: "",
    driving_criterion: "",
    confidence: 3,
    sources_opened: 0,
  });
  const [done, setDone] = useState(false);
  useEffect(() => {
    api<any>(`/study?list_id=${listId}`).then((r) => {
      setCases(r.cases);
      setIndex(0);
      setStarted(Date.now());
      setResponses([]);
      setDone(false);
    });
  }, [listId]);
  const current = cases[index];
  async function next() {
    if (!form.rationale || !form.driving_criterion) return;
    const response = {
      pair_id: current.case_id,
      case_id: current.case_id,
      arm: current.arm,
      decision: form.decision,
      rationale: form.rationale,
      driving_criterion: form.driving_criterion,
      confidence: Number(form.confidence),
      ms_to_decision: Date.now() - started,
      sources_opened: form.sources_opened,
    };
    const all = [...responses, response];
    setResponses(all);
    if (index + 1 < cases.length) {
      setIndex(index + 1);
      setStarted(Date.now());
      setForm({
        decision: "follow_up",
        rationale: "",
        driving_criterion: "",
        confidence: 3,
        sources_opened: 0,
      });
    } else {
      const payload = {
        run_id: `RUN-${Date.now()}`,
        app_version: "talentiq-mvp-1.0",
        participant_code: participant,
        list: listId,
        dry_run: false,
        exported_at: new Date().toISOString(),
        events: [],
        decisions: all,
      };
      await api("/study/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${participant}-${listId}.json`;
      a.click();
      setDone(true);
    }
  }
  if (!current)
    return (
      <div className="empty">
        <RefreshCw className="spin" />
        <h3>Loading study cases</h3>
      </div>
    );
  if (done)
    return (
      <div className="success-card">
        <Check />
        <h2>Study export saved</h2>
        <p>
          {responses.length} decisions were saved to SQL and downloaded as an
          append-only JSON export.
        </p>
        <button
          className="button"
          onClick={() => {
            setIndex(0);
            setResponses([]);
            setDone(false);
          }}
        >
          Start another session
        </button>
      </div>
    );
  const r = current.record;
  const required = criteria.filter(
    (c) => c.job_id === r.job_id && c.priority === "required" && !c.deferred,
  );
  return (
    <div className="study-shell">
      <div className="study-toolbar">
        <div>
          <span className="eyebrow">Balanced two-arm study</span>
          <h2>
            {index + 1} of {cases.length}
          </h2>
        </div>
        <label>
          Participant
          <input
            value={participant}
            onChange={(e) => setParticipant(e.target.value)}
          />
        </label>
        <label>
          Assignment
          <select value={listId} onChange={(e) => setListId(e.target.value)}>
            {lists.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="study-record">
        {current.arm === "B" && (
          <div className="rollup">
            Requirements matched: {r.arm_b_only.rollup.matched} /{" "}
            {r.arm_b_only.rollup.total}
          </div>
        )}
        <div className="record-title">
          <div>
            <span className="eyebrow">{r.job_title}</span>
            <h2>{r.display_code}</h2>
          </div>
          <span className="arm-label">Arm {current.arm}</span>
        </div>
        {r.criterion_states
          .filter((s: any) =>
            required.some((c) => c.criterion_id === s.criterion_id),
          )
          .map((s: any) => {
            const c = criteria.find((x) => x.criterion_id === s.criterion_id)!;
            const ev = r.evidence.filter((e: any) =>
              s.basis_ids.includes(e.evidence_id),
            );
            return (
              <article className="study-criterion" key={s.criterion_id}>
                <div>
                  <StatePill state={s.state} />
                  <h4>{c.label}</h4>
                </div>
                {ev.map((e: any) => (
                  <details
                    key={e.evidence_id}
                    onToggle={(event) => {
                      if ((event.target as HTMLDetailsElement).open)
                        setForm((x) => ({
                          ...x,
                          sources_opened: x.sources_opened + 1,
                        }));
                    }}
                  >
                    <summary>Open source evidence</summary>
                    <blockquote>“{e.quote}”</blockquote>
                  </details>
                ))}
              </article>
            );
          })}
        <div className="study-form">
          <label>
            Decision
            <select
              value={form.decision}
              onChange={(e) =>
                setForm((x) => ({ ...x, decision: e.target.value }))
              }
            >
              <option value="advance">Advance</option>
              <option value="follow_up">Follow-up</option>
              <option value="not_moving_forward">Not moving forward</option>
            </select>
          </label>
          <label>
            Driving requirement
            <select
              required
              value={form.driving_criterion}
              onChange={(e) =>
                setForm((x) => ({ ...x, driving_criterion: e.target.value }))
              }
            >
              <option value="">Select one</option>
              {required.map((c) => (
                <option value={c.criterion_id} key={c.criterion_id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="wide">
            Rationale
            <textarea
              required
              rows={4}
              value={form.rationale}
              onChange={(e) =>
                setForm((x) => ({ ...x, rationale: e.target.value }))
              }
            />
          </label>
          <label>
            Confidence: {form.confidence}/5
            <input
              type="range"
              min="1"
              max="5"
              value={form.confidence}
              onChange={(e) =>
                setForm((x) => ({ ...x, confidence: Number(e.target.value) }))
              }
            />
          </label>
          <button
            className="button"
            onClick={next}
            disabled={!form.rationale || !form.driving_criterion}
          >
            {index + 1 === cases.length ? "Export session" : "Next case"}
            <ArrowRight />
          </button>
        </div>
      </div>
    </div>
  );
}

function Audit({ candidate }: { candidate: CandidateDetail }) {
  return (
    <div>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Append-only history</span>
          <h2>{candidate.full_name}</h2>
        </div>
        <span className="code">{candidate.short_code}</span>
      </div>
      <div className="timeline">
        {candidate.audit.length ? (
          candidate.audit.map((a: any) => (
            <article key={a.audit_id}>
              <span className="timeline-dot" />
              <time>{new Date(a.created_at).toLocaleString()}</time>
              <h4>
                {a.action} · {a.entity}
              </h4>
              <p>Actor: {a.actor}</p>
            </article>
          ))
        ) : (
          <div className="empty">
            <Activity />
            <h3>No changes recorded yet</h3>
            <p>Approvals, edits, decisions, and intake changes appear here.</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
