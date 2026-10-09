import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  Copy,
  FileUp,
  Mail,
  Mic,
  MessageSquareText,
  Plus,
  RefreshCw,
  Save,
  ScanLine,
  SlidersHorizontal,
  Sparkles,
  Star,
  Square,
  Trash2,
  Trophy,
  UserCheck,
  X,
} from "lucide-react";
import QRCode from "qrcode";
import jsQR from "jsqr";
import { api } from "./api";

const gapLabels: Record<string, string> = {
  full_name: "Full name",
  email: "Email",
  phone: "Phone number",
  degree_field: "Degree field",
  expected_grad: "Expected graduation",
  skills: "Skills",
  years_experience: "Years of applicable experience",
  technical_experience_years: "Years of hands-on technical experience",
  technical_experience_summary: "Describe your hands-on technical experience and what you personally did",
  work_authorization: "Work authorization",
  degree_level: "Degree level",
  certifications: "Certifications or licenses",
  languages: "Languages",
  location: "Current location or preferred work location",
  work_mode: "Preferred work arrangement",
  travel_percent: "Maximum travel percentage",
  leadership_experience_years: "Years of leadership experience",
  management_experience_years: "Years of people-management experience",
  project_management_experience_years: "Years of project-management experience",
  internship_experience_years: "Years of internship or co-op experience",
  licenses: "Professional licenses",
  domain_experience: "Industry or domain experience",
  project_count: "Number of relevant projects",
  employment_type: "Employment type availability",
  shift_availability: "Shift availability",
  start_date: "Available start month",
  relocation_willingness: "Willing to relocate",
  portfolio_available: "Portfolio or work sample available",
  clearance_level: "Security clearance",
};

const JOB_FIELD_OPTIONS = [
  ["skills","Skills"], ["years_experience","Applicable experience"], ["technical_experience_years","Technical experience"],
  ["leadership_experience_years","Leadership experience"], ["management_experience_years","People-management experience"],
  ["project_management_experience_years","Project-management experience"],
  ["internship_experience_years","Internship / co-op experience"], ["project_count","Relevant project count"],
  ["degree_field","Education field"], ["degree_level","Education level"], ["expected_grad","Expected graduation"],
  ["certifications","Certifications"], ["licenses","Professional licenses"], ["domain_experience","Industry / domain experience"],
  ["languages","Languages"], ["location","Location"], ["work_mode","Work arrangement"], ["employment_type","Employment type"],
  ["shift_availability","Shift availability"], ["start_date","Available start date"], ["travel_percent","Travel availability"],
  ["relocation_willingness","Relocation willingness"], ["portfolio_available","Portfolio available"],
  ["clearance_level","Security clearance"], ["work_authorization","Work authorization"],
] as const;

const OPERATOR_LABELS: Record<string,string> = {
  gte: "≥ at least", lte: "≤ at most", between: "within range", in: "one of", equals: "= equals",
  has_skill: "contains", has_any_skill: "contains any", has_any: "contains any",
  on_or_after: "≥ on or after", on_or_before: "≤ on or before",
};
const FIELD_OPERATORS: Record<string,string[]> = {
  skills:["has_skill","has_any_skill"], degree_field:["in","equals"], degree_level:["in","equals"],
  expected_grad:["on_or_after","on_or_before","equals"], years_experience:["gte","lte","between"],
  technical_experience_years:["gte","lte","between"], leadership_experience_years:["gte","lte","between"],
  management_experience_years:["gte","lte","between"], project_management_experience_years:["gte","lte","between"],
  internship_experience_years:["gte","lte","between"], project_count:["gte","lte","between"],
  certifications:["has_any"], licenses:["has_any"], domain_experience:["has_any"], languages:["has_any"],
  location:["equals","in"], work_mode:["equals","in"], employment_type:["equals","in"], shift_availability:["has_any","in"],
  start_date:["on_or_after","on_or_before","equals"], travel_percent:["gte","lte","between"],
  relocation_willingness:["equals"], portfolio_available:["equals"], clearance_level:["equals","in"], work_authorization:["equals"],
};
const operatorSymbol = (value:string) => ({gte:"≥",lte:"≤",between:"↔",in:"∈",equals:"=",has_skill:"contains",has_any_skill:"contains any",has_any:"contains any",on_or_after:"≥",on_or_before:"≤"}[value] || value);
const fieldLabel = (key:string) => JOB_FIELD_OPTIONS.find(([value])=>value===key)?.[1] || key.replaceAll("_"," ");
const TRAIT_EVIDENCE_COMPETENCIES: Record<string,string[]> = {
  problem_solving:["problem_solving","programming","software_practices","requirements"],
  critical_thinking:["problem_solving","requirements","prioritization"],
  collaboration:["collaboration"], communication:["communication"], initiative:["ownership"],
  adaptability:["adaptability","learning"], product_thinking:["product_thinking","product_experience","requirements","prioritization"],
};
const evidenceForTrait = (evidence:any[], traitId:string) => evidence.filter((item:any)=>item.competency_ids?.some((id:string)=>(TRAIT_EVIDENCE_COMPETENCIES[traitId]||[traitId]).includes(id)));

export function JobSetup({
  setup,
  onRefresh,
}: {
  setup: any;
  onRefresh: () => Promise<void>;
}) {
  const [form, setForm] = useState<any>({
    title: "",
    department: "",
    description: "",
    requirements: [
      {
        field_key: "skills",
        operator: "has_any_skill",
        expected: "",
        label: "",
        weight: 2,
        enabled: true,
      },
    ],
    traits: [],
    checklist_items: setup.checklist_items.map((x: any) => x.item_id),
  });
  const [busy, setBusy] = useState(false);
  const [jobText, setJobText] = useState("");
  const [parseBusy, setParseBusy] = useState(false);
  const [aiRefining, setAiRefining] = useState(false);
  const [parseNote, setParseNote] = useState("");
  const [draftMeta, setDraftMeta] = useState<any>(null);
  const [lastCreated, setLastCreated] = useState<any>(null);
  const [recruiterEmail, setRecruiterEmail] = useState("");
  const [formError, setFormError] = useState("");
  const updateReq = (i: number, key: string, value: any) =>
    setForm((x: any) => ({
      ...x,
      requirements: x.requirements.map((r: any, n: number) =>
        n === i ? { ...r, [key]: value } : r,
      ),
    }));
  async function analyzeJobText() {
    if (!jobText.trim()) return;
    setParseBusy(true);
    setFormError("");
    try {
      const draft = await api<any>("/jobs/parse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: jobText, mode: "fast" }),
      });
      setForm((current: any) => ({
        ...current,
        title: draft.title || current.title,
        department: draft.department || current.department,
        description: draft.description,
        requirements: draft.requirements.map((rule: any) => ({
          ...rule,
          enabled: true,
          expected: Array.isArray(rule.expected) ? rule.expected.join(", ") : String(rule.expected ?? ""),
        })),
        traits: draft.traits,
      }));
      setDraftMeta(draft);
      setParseNote(`${draft.requirements.length} conditions ready now · local AI is checking for additional requirements in the background`);
      setParseBusy(false);
      setAiRefining(true);
      try {
        const refined = await api<any>("/jobs/parse", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({text:jobText,mode:"ai"}) });
        setForm((current:any)=>{
          const seen=new Set(current.requirements.map((rule:any)=>`${rule.field_key}:${rule.operator}:${String(rule.expected).toLowerCase()}`));
          const additions=refined.requirements.filter((rule:any)=>!seen.has(`${rule.field_key}:${rule.operator}:${Array.isArray(rule.expected)?rule.expected.join(", ").toLowerCase():String(rule.expected).toLowerCase()}`)).map((rule:any)=>({...rule,enabled:true,expected:Array.isArray(rule.expected)?rule.expected.join(", "):String(rule.expected??"")}));
          const traitMap=new Map([...current.traits,...refined.traits].map((trait:any)=>[trait.trait_id,trait]));
          return {...current,title:current.title||refined.title,department:current.department||refined.department,requirements:[...current.requirements,...additions],traits:[...traitMap.values()]};
        });
        setDraftMeta(refined);
        setParseNote(`${refined.requirements.length} reviewed condition drafts · ${refined.provenance.model} · hiring-team confirmation still required`);
      } catch {
        setParseNote(`${draft.requirements.length} instant conditions ready · local AI refinement unavailable, so the verified rules were kept`);
      } finally { setAiRefining(false); }
    } catch(error:any) {
      setFormError(error?.message || "The job description could not be parsed.");
    } finally {
      setParseBusy(false);
    }
  }
  function confirmationEmail() {
    const selectedRules = form.requirements.filter((rule: any) => rule.enabled !== false);
    const traitNames = form.traits.map((selected: any) => setup.traits.find((trait: any) => trait.trait_id === selected.trait_id)?.label).filter(Boolean);
    const checklistNames = form.checklist_items.map((id: string) => setup.checklist_items.find((item: any) => item.item_id === id)?.label).filter(Boolean);
    const body = [
      `Hi,`,
      ``,
      `Could you confirm that these are the correct hiring criteria for ${form.title || "this role"}? Barry will not publish the job until a person reviews them.`,
      ``,
      `Quantitative conditions:`,
      ...selectedRules.map((rule: any) => `- ${rule.label || `${fieldLabel(rule.field_key)} ${operatorSymbol(rule.operator)} ${rule.expected}`}`),
      ``,
      `Conversation traits: ${traitNames.join(", ") || "None selected"}`,
      `Baseline checklist: ${checklistNames.join(", ") || "None selected"}`,
      ``,
      `Please reply with anything to add, remove, or change.`,
      ``,
      `Thank you,`,
    ].join("\n");
    return { subject: `Please confirm Barry criteria — ${form.title || "open role"}`, body };
  }
  async function copyConfirmationEmail() {
    const email = confirmationEmail();
    await navigator.clipboard.writeText(`Subject: ${email.subject}\n\n${email.body}`);
    setParseNote("Recruiter confirmation email copied.");
  }
  function openConfirmationEmail() {
    const email = confirmationEmail();
    window.location.href = `mailto:${encodeURIComponent(recruiterEmail)}?subject=${encodeURIComponent(email.subject)}&body=${encodeURIComponent(email.body)}`;
  }
  async function submit(e: any) {
    e.preventDefault();
    setBusy(true);
    setFormError("");
    try {
      const created = await api<any>("/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...form,
          requirements: form.requirements.filter((r: any) => r.enabled !== false).map((r: any) => ({
            ...r,
            expected:
              ["gte","lte"].includes(r.operator)
                ? Number(r.expected)
                : r.operator === "between"
                  ? String(r.expected).split(/,|–|-|to/).map((x:string)=>Number(x.trim())).filter((x:number)=>Number.isFinite(x)).slice(0,2)
                : ["has_any_skill", "has_any", "in"].includes(r.operator)
                  ? r.expected
                      .split(",")
                      .map((x: string) => x.trim())
                      .filter(Boolean)
                  : ["relocation_willingness","portfolio_available"].includes(r.field_key)
                    ? String(r.expected).toLowerCase()==="true"
                    : String(r.expected).trim(),
          })),
        }),
      });
      setLastCreated(created);
      setForm({
        title: "",
        department: "",
        description: "",
        requirements: [
          {
            field_key: "skills",
            operator: "has_any_skill",
            expected: "",
            label: "",
            weight: 2,
            enabled: true,
          },
        ],
        traits: [],
        checklist_items: setup.checklist_items.map((x: any) => x.item_id),
      });
      await onRefresh();
    } catch(error:any) {
      setFormError(error?.message || "The job could not be created.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="workflow-page">
      <div className="workflow-intro">
        <div>
          <span className="eyebrow">Before the fair</span>
          <h2>Define what the job actually needs.</h2>
          <p>
            Quantitative rules come from candidate data. Recruiters assess only
            the selected human traits and baseline checklist.
          </p>
        </div>
        <div className="logic-note">
          <SlidersHorizontal />
          <span>
            <strong>Transparent by construction</strong>Every condition and
            weight remains visible in the match explanation.
          </span>
        </div>
        <span className="context-photo-credit">Recruitment-table photo: Marc A. Hermann / Metropolitan Transportation Authority · <a href="https://commons.wikimedia.org/wiki/File:EWT_Career_Fair_(53585232212).jpg" target="_blank" rel="noreferrer">source</a> · <a href="https://creativecommons.org/licenses/by/2.0/" target="_blank" rel="noreferrer">CC BY 2.0</a></span>
      </div>
      <div className="setup-grid">
        <form className="panel job-form" onSubmit={submit}>
          <h3>Create an open job</h3>
          <section className="job-intake-assistant">
            <div className="assistant-heading"><Sparkles/><span><strong>Paste the recruiter’s job description</strong><small>The assistant proposes checkable rules. Nothing is created until you review and submit.</small></span></div>
            <textarea rows={7} value={jobText} placeholder="Paste the full job description or recruiter paragraph here…" onChange={(event)=>setJobText(event.target.value)}/>
            <button type="button" className="button secondary" disabled={!jobText.trim()||parseBusy} onClick={analyzeJobText}>{parseBusy?<RefreshCw className="spin"/>:<Sparkles/>} Draft checkable conditions</button>
            {parseNote&&<small className="assistant-status">{aiRefining&&<RefreshCw className="spin"/>}{parseNote}</small>}
            {formError&&<div className="form-error" role="alert"><AlertTriangle/><span><strong>Job was not saved.</strong>{formError}</span></div>}
            {draftMeta&&<div className="job-pipeline-proof">
              <div><span className="eyebrow">Data cleansing</span><strong>{draftMeta.provenance.model}</strong><small>{draftMeta.cleansing.input_characters} input characters → {draftMeta.cleansing.cleaned_characters} cleaned · duplicates normalized · sensitive fields excluded</small></div>
              <ol>{draftMeta.process.map((step:string)=><li key={step}>{step}</li>)}</ol>
              <p><strong>AI boundary:</strong> this stage drafts structured conditions. The hiring team checks every row; the later match is deterministic, not an AI opinion.</p>
            </div>}
          </section>
          {form.requirements.some((rule:any)=>rule.enabled!==false)&&<section className="condition-preview">
            <div className="section-heading"><div><span className="eyebrow">Conditional supply database</span><h4>Rows that will be saved</h4></div><span>Hiring-team review required</span></div>
            <div className="condition-card-grid">{form.requirements.filter((rule:any)=>rule.enabled!==false).map((rule:any,index:number)=><article className="condition-card" key={`${rule.field_key}-${index}`}><div><span className="sql-state">Candidate fact</span><small>{form.title||"Untitled job"}</small></div><h5>{fieldLabel(rule.field_key)}</h5><div className="condition-expression"><strong>{operatorSymbol(rule.operator)}</strong><span>{String(rule.expected)||"Value needed"}</span></div><p>{rule.label||"Add a plain-language meaning before saving."}</p><details><summary>Database mapping</summary><code>{rule.field_key} · {rule.operator}</code></details></article>)}</div>
            <div className="condition-trait-row"><strong>Recruiter-observed traits</strong><div className="condition-chip-list">{form.traits.length?form.traits.map((item:any)=><span key={item.trait_id}>{setup.traits.find((trait:any)=>trait.trait_id===item.trait_id)?.label}</span>):<em>None selected yet</em>}</div><strong>Baseline requirements</strong><div className="condition-chip-list">{form.checklist_items.length?form.checklist_items.map((id:string)=><span key={id}>{setup.checklist_items.find((item:any)=>item.item_id===id)?.label}</span>):<em>None selected</em>}</div></div>
          </section>}
          {lastCreated&&<section className="created-job-proof"><Check/><span><strong>{lastCreated.title} is now in SQLite.</strong><small>{lastCreated.requirements.length} conditional rows · {lastCreated.traits.length} qualitative traits · {lastCreated.checklist.length} baseline items. Open Database to inspect or delete it.</small></span></section>}
          <div className="form-grid">
            <label>
              Job title
              <input
                required
                value={form.title}
                onChange={(e) =>
                  setForm((x: any) => ({ ...x, title: e.target.value }))
                }
              />
            </label>
            <label>
              Department
              <input
                required
                value={form.department}
                onChange={(e) =>
                  setForm((x: any) => ({ ...x, department: e.target.value }))
                }
              />
            </label>
          </div>
          <label>
            Description
            <textarea
              rows={3}
              value={form.description}
              onChange={(e) =>
                setForm((x: any) => ({ ...x, description: e.target.value }))
              }
            />
          </label>
          <div className="form-section">
            <div className="section-heading">
              <h4>Quantitative requirements</h4>
              <button
                type="button"
                className="text-button dark"
                onClick={() =>
                  setForm((x: any) => ({
                    ...x,
                    requirements: [
                      ...x.requirements,
                      {
                        field_key: "skills",
                        operator: "has_any_skill",
                        expected: "",
                        label: "",
                        weight: 1,
                        enabled: true,
                      },
                    ],
                  }))
                }
              >
                <Plus /> Add condition
              </button>
            </div>
            {form.requirements.map((r: any, i: number) => (
              <div className={r.enabled===false?"rule-row disabled-rule":"rule-row"} key={i}>
                <label className="rule-enabled" title="Include this condition"><input type="checkbox" checked={r.enabled!==false} onChange={(e)=>updateReq(i,"enabled",e.target.checked)}/><span>{r.enabled===false?"Excluded":"Use"}</span></label>
                <select
                  value={r.field_key}
                  onChange={(e) => {
                    const field = e.target.value;
                    updateReq(i, "field_key", field);
                    updateReq(i,"operator",FIELD_OPERATORS[field]?.[0]||"equals");
                    updateReq(i,"expected","");
                  }}
                >
                  {JOB_FIELD_OPTIONS.map(([value,label])=><option value={value} key={value}>{label}</option>)}
                </select>
                <select
                  value={r.operator}
                  onChange={(e) => updateReq(i, "operator", e.target.value)}
                >
                  {(FIELD_OPERATORS[r.field_key]||["equals"]).map((value)=><option value={value} key={value}>{OPERATOR_LABELS[value]||value}</option>)}
                </select>
                {["relocation_willingness","portfolio_available"].includes(r.field_key)?<select required value={String(r.expected)} onChange={(e)=>updateReq(i,"expected",e.target.value)}><option value="">Choose…</option><option value="true">Yes</option><option value="false">No</option></select>:<input
                  required
                  type={["expected_grad","start_date"].includes(r.field_key) ? "month" : ["gte","lte"].includes(r.operator) ? "number" : "text"}
                  min={["gte","lte"].includes(r.operator) ? "0" : undefined}
                  step={["gte","lte"].includes(r.operator) ? ".5" : undefined}
                  placeholder={["expected_grad","start_date"].includes(r.field_key) ? "Choose month" : "SQL, Python"}
                  value={r.expected}
                  onChange={(e) => updateReq(i, "expected", e.target.value)}
                />}
                <input
                  required
                  placeholder="Human-readable label"
                  value={r.label}
                  onChange={(e) => updateReq(i, "label", e.target.value)}
                />
                <button
                  type="button"
                  onClick={() =>
                    setForm((x: any) => ({
                      ...x,
                      requirements: x.requirements.filter(
                        (_: any, n: number) => n !== i,
                      ),
                    }))
                  }
                  aria-label="Remove condition"
                >
                  <Trash2 />
                </button>
              </div>
            ))}
          </div>
          <div className="form-section">
            <h4>Job-specific traits</h4>
            <div className="selection-grid">
              {setup.traits.map((t: any) => (
                <label className="choice-card" key={t.trait_id}>
                  <input
                    type="checkbox"
                    checked={form.traits.some(
                      (x: any) => x.trait_id === t.trait_id,
                    )}
                    onChange={(e) =>
                      setForm((x: any) => ({
                        ...x,
                        traits: e.target.checked
                          ? [
                              ...x.traits,
                              {
                                trait_id: t.trait_id,
                                min_rating: 4,
                                weight: 1,
                              },
                            ]
                          : x.traits.filter(
                              (z: any) => z.trait_id !== t.trait_id,
                            ),
                      }))
                    }
                  />
                  <span>
                    <strong>{t.label}</strong>
                    <small>{t.description}</small>
                  </span>
                </label>
              ))}
            </div>
          </div>
          <div className="form-section">
            <h4>Baseline checklist</h4>
            <div className="selection-grid">
              {setup.checklist_items.map((item: any) => (
                <label className="choice-card" key={item.item_id}>
                  <input
                    type="checkbox"
                    checked={form.checklist_items.includes(item.item_id)}
                    onChange={(e) =>
                      setForm((x: any) => ({
                        ...x,
                        checklist_items: e.target.checked
                          ? [...x.checklist_items, item.item_id]
                          : x.checklist_items.filter(
                              (z: string) => z !== item.item_id,
                            ),
                      }))
                    }
                  />
                  <span>
                    <strong>{item.label}</strong>
                    <small>{item.description}</small>
                  </span>
                </label>
              ))}
            </div>
          </div>
          <section className="recruiter-confirmation">
            <div className="assistant-heading"><Mail/><span><strong>Ask the recruiter to confirm</strong><small>Creates an email draft containing only the conditions and traits you selected. It never sends automatically.</small></span></div>
            <input type="email" value={recruiterEmail} placeholder="Recruiter email (optional for copying)" onChange={(event)=>setRecruiterEmail(event.target.value)}/>
            <div className="confirmation-actions"><button type="button" className="button secondary" onClick={copyConfirmationEmail}><Copy/> Copy email</button><button type="button" className="button secondary" onClick={openConfirmationEmail}><Mail/> Open email draft</button></div>
          </section>
          <button className="button" disabled={busy}>
            {busy ? <RefreshCw className="spin" /> : <Plus />} Create job
          </button>
        </form>
        <div className="job-stack">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Open now</span>
              <h3>{setup.jobs.length} jobs</h3>
            </div>
          </div>
          {setup.jobs.map((job: any) => (
            <article className="job-card" key={job.job_id}>
              <div>
                <span>{job.department}</span>
                <strong>Open</strong>
              </div>
              <h3>{job.title}</h3>
              <p>{job.description}</p>
              <dl>
                <div>
                  <dt>{job.requirements.length}</dt>
                  <dd>data rules</dd>
                </div>
                <div>
                  <dt>{job.traits.length}</dt>
                  <dd>human traits</dd>
                </div>
                <div>
                  <dt>{job.checklist.length}</dt>
                  <dd>baseline items</dd>
                </div>
              </dl>
              <details>
                <summary>
                  See exact definition <ChevronDown />
                </summary>
                <ul>
                  {job.requirements.map((r: any) => (
                    <li key={r.requirement_id}>{r.label}</li>
                  ))}
                </ul>
                <p>
                  <b>Traits:</b>{" "}
                  {job.traits.map((t: any) => t.label).join(", ")}
                </p>
              </details>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}

function PhoneProgress({ step }: { step: 1 | 2 | 3 }) {
  return (
    <div className="phone-progress" aria-label={`Check-in step ${step} of 3`}>
      {["Résumé", "Confirm", "QR ready"].map((label, index) => (
        <span className={index + 1 <= step ? "active" : ""} key={label}>
          <i>{index + 1 < step ? <Check /> : index + 1}</i>
          {label}
        </span>
      ))}
    </div>
  );
}

export function CandidatePhoneFlow({
  onCreated,
  onViewDatabase,
}: {
  onCreated: (id: string) => Promise<void>;
  onViewDatabase: () => void;
}) {
  const [stage, setStage] = useState<"start" | "upload" | "gaps" | "done">(
    "start",
  );
  const [file, setFile] = useState<File | null>(null);
  const [resumeText, setResumeText] = useState("");
  const [parsed, setParsed] = useState<any>(null);
  const [answers, setAnswers] = useState<any>({});
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState("");
  const [validationAttempted, setValidationAttempted] = useState(false);
  const [parseError, setParseError] = useState("");
  const unresolvedGaps = (parsed?.gaps || []).filter((field:string) => {
    const value = answers[field];
    return value == null || (typeof value === "string" && value.trim() === "") || (Array.isArray(value) && value.length === 0);
  });
  async function parse() {
    if (!file && !resumeText.trim()) return;
    setBusy(true);
    setParseError("");
    try {
      let content_base64="";
      if(file){
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = "";
        for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        content_base64=btoa(binary);
      }
      const r = await api<any>("/resume/parse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          file_name: file?.name || "pasted-resume.txt",
          mime_type: file?.type || "text/plain",
          content_base64,
          text: resumeText,
        }),
      });
      setParsed(r);
      setAnswers({ ...r.profile });
      setStage("gaps");
    } catch(error:any) {
      setParseError(error?.message || "The résumé could not be parsed. Paste the text below and try again.");
    } finally {
      setBusy(false);
    }
  }
  async function finalize() {
    if (unresolvedGaps.length) {
      setValidationAttempted(true);
      document.querySelector(`[data-gap-field="${unresolvedGaps[0]}"] input, [data-gap-field="${unresolvedGaps[0]}"] textarea, [data-gap-field="${unresolvedGaps[0]}"] select`)?.scrollIntoView({behavior:"smooth",block:"center"});
      return;
    }
    setBusy(true);
    try {
      const numberOrUnknown=(value:any)=>value==null||String(value).trim()===""?null:Number(value);
      const normalized = {
        ...answers,
        skills: Array.isArray(answers.skills)
          ? answers.skills
          : String(answers.skills || "")
              .split(",")
              .map((x: string) => x.trim())
              .filter(Boolean),
        certifications: Array.isArray(answers.certifications) ? answers.certifications : String(answers.certifications||"").split(",").map((value:string)=>value.trim()).filter(Boolean).map((credential:string)=>({credential,source_text:"Candidate confirmed"})),
        languages: Array.isArray(answers.languages) ? answers.languages : String(answers.languages||"").split(",").map((value:string)=>value.trim()).filter(Boolean),
        licenses: Array.isArray(answers.licenses) ? answers.licenses : String(answers.licenses||"").split(",").map((value:string)=>value.trim()).filter(Boolean),
        domain_experience: Array.isArray(answers.domain_experience) ? answers.domain_experience : String(answers.domain_experience||"").split(",").map((value:string)=>value.trim()).filter(Boolean),
        shift_availability: Array.isArray(answers.shift_availability) ? answers.shift_availability : String(answers.shift_availability||"").split(",").map((value:string)=>value.trim()).filter(Boolean),
        years_experience: numberOrUnknown(answers.years_experience),
        technical_experience_years: numberOrUnknown(answers.technical_experience_years),
        leadership_experience_years: numberOrUnknown(answers.leadership_experience_years),
        management_experience_years: numberOrUnknown(answers.management_experience_years),
        project_management_experience_years: numberOrUnknown(answers.project_management_experience_years),
        internship_experience_years: numberOrUnknown(answers.internship_experience_years),
        project_count: numberOrUnknown(answers.project_count),
        travel_percent: numberOrUnknown(answers.travel_percent),
      };
      await api(`/candidates/${parsed.candidate_id}/finalize`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answers: normalized }),
      });
      const config = await api<any>("/config");
      setQr(
        await QRCode.toDataURL(
          (() => {
            const destination = new URL(window.location.pathname, config.public_base_url || window.location.origin);
            destination.searchParams.set("view", "recruiter");
            destination.searchParams.set("candidate", parsed.candidate_id);
            return destination.toString();
          })(),
          {
            width: 280,
            margin: 1,
            color: { dark: "#123d32", light: "#ffffff" },
          },
        ),
      );
      setStage("done");
      await onCreated(parsed.candidate_id);
    } catch(error:any) {
      setParseError(error?.message || "The candidate record could not be finalized.");
    } finally {
      setBusy(false);
    }
  }
  if (stage === "start")
    return (
      <div className="phone-frame">
        <div className="phone-hero">
          <span className="logo-mark brand-logo-shell"><img src="/barry-emblem.png" alt="Barry geometric bee logo" /></span>
          <span className="eyebrow light">Barry candidate check-in</span>
          <h2>Your résumé, already organized.</h2>
          <p>
            You provide the facts. Recruiters record their own observations.
            Matching uses transparent job rules.
          </p>
          <button className="button light" onClick={() => setStage("upload")}>
            Add Candidate <ArrowRight />
          </button>
          <span className="context-photo-credit">Photo: Marc A. Hermann / MTA · <a href="https://commons.wikimedia.org/wiki/File:EWT_Career_Fair_(53585232212).jpg" target="_blank" rel="noreferrer">source</a> · <a href="https://creativecommons.org/licenses/by/2.0/" target="_blank" rel="noreferrer">CC BY 2.0</a></span>
        </div>
        <div className="privacy-strip">
          <Check />
          <span>
            Your information creates a candidate record immediately after
            upload.
          </span>
        </div>
      </div>
    );
  if (stage === "upload")
    return (
      <div className="phone-frame light">
        <PhoneProgress step={1} />
        <span className="eyebrow">Candidate check-in</span>
        <h2>Add your résumé</h2>
        <p className="muted">
          PDF or DOCX. The backend extracts standard fields and asks only for
          what is missing.
        </p>
        <label className="upload-zone">
          <FileUp />
          <strong>{file ? file.name : "Choose a résumé"}</strong>
          <span>
            {file ? `${Math.round(file.size / 1024)} KB` : "PDF, DOCX, or text"}
          </span>
          <input
            type="file"
            accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={(e) => {setFile(e.target.files?.[0] || null);setParseError("");}}
          />
        </label>
        <div className="upload-divider"><span>or paste résumé text</span></div>
        <textarea className="resume-paste" rows={6} value={resumeText} placeholder="Paste the résumé here if the PDF is scanned, locked, or not parsing…" onChange={(event)=>{setResumeText(event.target.value);setParseError("");}} />
        {parseError&&<div className="form-error" role="alert"><AlertTriangle/><span><strong>Record was not created.</strong>{parseError}</span></div>}
        <button
          className="button full"
          disabled={(!file && !resumeText.trim()) || busy}
          onClick={parse}
        >
          {busy ? <RefreshCw className="spin" /> : <Sparkles />} Parse and
          create record
        </button>
      </div>
    );
  if (stage === "gaps")
    return (
      <div className="phone-frame light">
        <PhoneProgress step={2} />
        <span className="eyebrow">Candidate check-in</span>
        <h2>Complete only the gaps</h2>
        <div className="parsed-summary">
          <Check />
          <span>
            <strong>{answers.full_name || "Candidate record"}</strong>
            <small>{parsed.extraction?.message || `Candidate ID ${parsed.short_code}`}</small>
            <small>Candidate ID {parsed.short_code} · {parsed.gaps.length} question{parsed.gaps.length===1?"":"s"} remaining</small>
          </span>
        </div>
        <section className="resume-intake-inventory">
          <div className="inventory-heading"><span><strong>Résumé data captured</strong><small>Structured facts—not just a summary</small></span><b>{(answers.work_experience||[]).length} roles · {(answers.skills||[]).length} skills · {(answers.projects||[]).length} projects</b></div>
          {!!answers.work_experience?.length&&<details open><summary>Work experience ({answers.work_experience.length})</summary><div className="inventory-list">{answers.work_experience.map((role:any,index:number)=><article key={index}><strong>{role.role_title||"Role listed on résumé"}</strong><small>{[role.organization,role.start_date&&`${role.start_date}–${role.end_date}`].filter(Boolean).join(" · ")}</small><p>{role.description||role.source_text}</p></article>)}</div></details>}
          {!!answers.skills?.length&&<details open><summary>Skills ({answers.skills.length})</summary><div className="inventory-chips">{answers.skills.map((skill:string)=><span key={skill}>{skill}</span>)}</div></details>}
          {!!answers.education_history?.length&&<details><summary>Education ({answers.education_history.length})</summary><div className="inventory-list">{answers.education_history.map((row:any,index:number)=><article key={index}><strong>{row.degree||row.field_of_study||"Education"}</strong><small>{[row.institution,row.graduation_date].filter(Boolean).join(" · ")}</small></article>)}</div></details>}
          {!!answers.projects?.length&&<details><summary>Projects ({answers.projects.length})</summary><div className="inventory-list">{answers.projects.map((project:any,index:number)=><article key={index}><strong>{project.name||"Résumé project"}</strong><p>{project.description}</p><small>{project.skills?.join(", ")}</small></article>)}</div></details>}
          {!!answers.certifications?.length&&<details><summary>Certifications ({answers.certifications.length})</summary><div className="inventory-chips">{answers.certifications.map((item:any,index:number)=><span key={index}>{item.credential||item}</span>)}</div></details>}
          {!!answers.links?.length&&<details><summary>Professional links ({answers.links.length})</summary><div className="inventory-chips">{answers.links.map((item:any,index:number)=><span key={index}>{item.type}: {item.url}</span>)}</div></details>}
        </section>
        {parsed.gaps.map((field: string) => {
          const unresolved=unresolvedGaps.includes(field);
          return <label key={field} data-gap-field={field} className={unresolved&&validationAttempted?"gap-question invalid":"gap-question"}>
            <span>{gapLabels[field] || field}{!unresolved&&<Check/>}</span>
            {["skills","languages","certifications","licenses","domain_experience","shift_availability"].includes(field) ? (
              <input
                required
                value={
                  Array.isArray(answers[field])
                    ? answers[field].join(", ")
                    : answers[field] || ""
                }
                onChange={(e) =>
                  setAnswers((x: any) => ({ ...x, [field]: e.target.value }))
                }
              />
            ) : ["years_experience", "technical_experience_years","leadership_experience_years","management_experience_years","project_management_experience_years","internship_experience_years","project_count","travel_percent"].includes(field) ? (
              <input
                type="text"
                inputMode="decimal"
                pattern="[0-9]*[.]?[0-9]*"
                placeholder="Example: 3 or 3.5"
                value={answers[field] ?? ""}
                onChange={(e:any) => {
                  const value=String(e.target.value).replace(/[^0-9.]/g,"");
                  if(/^\d{0,3}(?:\.\d{0,2})?$/.test(value)) setAnswers((x:any)=>({...x,[field]:value}));
                }}
              />
            ) : field === "technical_experience_summary" ? (
              <textarea
                required
                rows={4}
                value={answers[field] || ""}
                placeholder="Example: Built a Python dashboard; I wrote the data-cleaning and chart code."
                onChange={(e) => setAnswers((x: any) => ({ ...x, [field]: e.target.value }))}
              />
            ) : ["relocation_willingness","portfolio_available"].includes(field) ? (
              <select required value={answers[field]===true?"yes":answers[field]===false?"no":""} onChange={(e)=>setAnswers((x:any)=>({...x,[field]:e.target.value==="yes"}))}>
                <option value="">Choose an answer</option><option value="yes">Yes</option><option value="no">No</option>
              </select>
            ) : ["expected_grad","start_date"].includes(field) ? (
              <span className="graduation-picker">
                <select aria-label="Expected graduation month" value={String(answers[field]||"").split("-")[1]||""} onChange={(e)=>setAnswers((x:any)=>({...x,[field]:`${String(x[field]||"").split("-")[0]||new Date().getFullYear()}-${e.target.value}`}))}>
                  <option value="">Month</option>{["01","02","03","04","05","06","07","08","09","10","11","12"].map((month,index)=><option value={month} key={month}>{new Date(2024,index,1).toLocaleString(undefined,{month:"long"})}</option>)}
                </select>
                <select aria-label="Expected graduation year" value={String(answers[field]||"").split("-")[0]||""} onChange={(e)=>setAnswers((x:any)=>({...x,[field]:`${e.target.value}-${String(x[field]||"").split("-")[1]||"05"}`}))}>
                  <option value="">Year</option>{Array.from({length:15},(_,index)=>new Date().getFullYear()-2+index).map(year=><option value={year} key={year}>{year}</option>)}
                </select>
              </span>
            ) : (
              <input
                required
                type={
                  field === "email"
                    ? "email"
                    : field === "phone"
                      ? "tel"
                    : "text"
                }
                value={answers[field] || ""}
                onChange={(e) =>
                  setAnswers((x: any) => ({ ...x, [field]: e.target.value }))
                }
              />
            )}
          </label>;
        })}
        <details className="review-extracted">
          <summary>Review extracted information</summary>
          {Object.entries(answers)
            .filter(([k,v]) => !parsed.gaps.includes(k) && !k.includes("summary") && gapLabels[k] && (typeof v==="string"||typeof v==="number"||Array.isArray(v)&&v.every(item=>typeof item==="string")))
            .map(([k, v]: any) => (
              <label key={k}>
                {gapLabels[k] || k}
                <input
                  value={Array.isArray(v) ? v.join(", ") : (v ?? "")}
                  onChange={(e) =>
                    setAnswers((x: any) => ({ ...x, [k]: e.target.value }))
                  }
                />
              </label>
            ))}
        </details>
        {unresolvedGaps.length>0&&<div className={validationAttempted?"gap-reminder active":"gap-reminder"}><AlertTriangle/><span><strong>Still needed:</strong> {unresolvedGaps.map((field:string)=>gapLabels[field]||field).join(" · ")}</span></div>}
        {parseError&&<div className="form-error" role="alert"><AlertTriangle/><span><strong>Could not finish check-in.</strong>{parseError}</span></div>}
        <button className="button full" onClick={finalize} disabled={busy}>
          {busy ? <RefreshCw className="spin" /> : <Check />} Scan Info Done
        </button>
      </div>
    );
  return (
    <div className="phone-frame light done-phone">
      <PhoneProgress step={3} />
      <Check />
      <span className="eyebrow">Your information is ready</span>
      <h2>{parsed.short_code}</h2>
      <p>Show this QR code to the recruiter.</p>
      <img src={qr} alt="Candidate QR code" />
      <small>
        Scanning opens this candidate directly in Recruiter Viewpoint.
      </small>
      <button className="button secondary full" onClick={onViewDatabase}>
        View candidate database
      </button>
    </div>
  );
}

export function RecruiterViewpoint({
  candidate,
  setup,
  recruiterId,
  onRecruiterChange,
  onSaved,
  onScan,
}: {
  candidate: any;
  setup: any;
  recruiterId: string;
  onRecruiterChange: (id: string) => Promise<void>;
  onSaved: () => Promise<void>;
  onScan: (id: string) => Promise<void>;
}) {
  const initialRatings = Object.fromEntries(
    (candidate.recruiter_ratings || []).map((x: any) => [x.trait_id, x.rating]),
  );
  const initialChecklist = Object.fromEntries(
    (candidate.checklist_ratings || []).map((x: any) => [x.item_id, x.passed]),
  );
  const [ratings, setRatings] = useState<any>(initialRatings);
  const [checklist, setChecklist] = useState<any>(initialChecklist);
  const [spill, setSpill] = useState("");
  const [preferences, setPreferences] = useState<string[]>(
    (candidate.preferences || []).map((x: any) => x.job_id),
  );
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [scanStatus, setScanStatus] = useState("");
  const [evidenceDrafts, setEvidenceDrafts] = useState<any[]>([]);
  const [modelName, setModelName] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [reframePrompts, setReframePrompts] = useState<any[]>([]);
  const [impressionScore, setImpressionScore] = useState<number | null>(candidate.impression?.impression_score ?? null);
  const [impressionRationale, setImpressionRationale] = useState(candidate.impression?.rationale || "");
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("");
  const [actionError, setActionError] = useState("");
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const mediaStream = useRef<MediaStream | null>(null);
  const audioChunks = useRef<Blob[]>([]);
  const stopTimer = useRef<number | null>(null);
  useEffect(() => {
    setRatings(
      Object.fromEntries(
        (candidate.recruiter_ratings || []).map((x: any) => [
          x.trait_id,
          x.rating,
        ]),
      ),
    );
    setChecklist(
      Object.fromEntries(
        (candidate.checklist_ratings || []).map((x: any) => [
          x.item_id,
          x.passed,
        ]),
      ),
    );
    setPreferences((candidate.preferences || []).map((x: any) => x.job_id));
    setSpill("");
    setDirty(false);
    setSaved(false);
    setEvidenceDrafts([]);
    setModelName("");
    setReframePrompts([]);
    setImpressionScore(candidate.impression?.impression_score ?? null);
    setImpressionRationale(candidate.impression?.rationale || "");
    setVoiceStatus("");
    setActionError("");
  }, [candidate.candidate_id, recruiterId]);
  useEffect(() => () => {
    if (stopTimer.current) window.clearTimeout(stopTimer.current);
    if (mediaRecorder.current?.state === "recording") mediaRecorder.current.stop();
    mediaStream.current?.getTracks().forEach(track => track.stop());
  }, []);
  const ratedCount = setup.traits.filter((trait: any) => Number(ratings[trait.trait_id]) >= 4).length;
  const checklistCount = setup.checklist_items.filter((item: any) => checklist[item.item_id] != null).length;
  const completedItems = (ratedCount > 0 ? 1 : 0) + checklistCount + (preferences.length ? 1 : 0) + (spill.trim() ? 1 : 0);
  const totalItems = setup.checklist_items.length + 3;
  const completion = Math.round((completedItems / Math.max(totalItems, 1)) * 100);
  const completionLabel = completion === 100 ? "Ready to save" : completion >= 70 ? "Almost ready" : completion >= 35 ? "In progress" : "Just started";
  async function save() {
    setActionError("");
    try {
      await api("/recruiter/capture", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          candidate_id: candidate.candidate_id,
          recruiter_id: recruiterId,
          ratings,
          checklist,
          spill,
          preferences,
          impression: impressionScore == null ? null : { score: impressionScore, label: ({"-2":"Concern","-1":"Some concerns","0":"Unclear","1":"Positive","2":"Very positive"} as any)[String(impressionScore)], rationale: impressionRationale.trim() || spill.trim() },
        }),
      });
      setSaved(true);
      setDirty(false);
      await onSaved();
      setTimeout(() => setSaved(false), 2200);
    } catch (error: any) {
      setActionError(error?.message || "The recruiter viewpoint could not be saved.");
    }
  }
  async function organizeSpillText(sourceText: string) {
    if (!sourceText.trim()) return;
    setAiBusy(true);
    setActionError("");
    try {
      const result = await api<any>("/extract/debrief", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ candidate_id: candidate.candidate_id, text: sourceText }),
      });
      setEvidenceDrafts(result.kept || []);
      setReframePrompts(result.prompts || []);
      setModelName(result.model || "evidence-extraction model");
    } catch (error: any) {
      setActionError(error?.message || "Spill could not be organized into evidence.");
    } finally {
      setAiBusy(false);
    }
  }
  async function organizeSpill() { await organizeSpillText(spill); }
  async function startVoiceCapture() {
    setVoiceStatus("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStream.current = stream;
      audioChunks.current = [];
      const preferred = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find(type => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, preferred ? { mimeType: preferred } : undefined);
      mediaRecorder.current = recorder;
      recorder.ondataavailable = event => { if (event.data.size) audioChunks.current.push(event.data); };
      recorder.onerror = () => setVoiceStatus("The microphone stopped unexpectedly. Please try again.");
      recorder.onstop = async () => {
        setRecording(false);
        mediaStream.current?.getTracks().forEach(track => track.stop());
        setTranscribing(true);
        setVoiceStatus("Transcribing privately on this computer…");
        try {
          const blob = new Blob(audioChunks.current, { type: recorder.mimeType || "audio/webm" });
          const bytes = new Uint8Array(await blob.arrayBuffer());
          let binary = "";
          for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
          const result = await api<any>("/transcribe", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ candidate_id: candidate.candidate_id, audio_base64: btoa(binary), mime_type: blob.type }),
          });
          const currentSpill = spill.trim();
          const combinedSpill = [currentSpill, result.text].filter(Boolean).join(currentSpill ? "\n" : "");
          setSpill(combinedSpill);
          setImpressionRationale((current: string) => current.trim() || combinedSpill);
          setDirty(true);
          setVoiceStatus(`Transcript added · ${result.model} · audio deleted · finding evidence…`);
          await organizeSpillText(combinedSpill);
          setVoiceStatus(`Voice Spill ready · ${result.model} · evidence drafts prepared · audio deleted`);
        } catch (error: any) {
          setVoiceStatus(error.message || "Local transcription failed. You can still type Spill notes.");
        } finally {
          audioChunks.current = [];
          setTranscribing(false);
        }
      };
      recorder.start(500);
      setRecording(true);
      setVoiceStatus("Recording locally… tap Stop when the conversation is finished.");
      stopTimer.current = window.setTimeout(() => {
        if (recorder.state === "recording") recorder.stop();
      }, 60_000);
    } catch (error: any) {
      setVoiceStatus(error.name === "NotAllowedError" ? "Microphone permission was denied. Allow microphone access, then try again." : (error.message || "Could not start the microphone."));
    }
  }
  function stopVoiceCapture() {
    if (stopTimer.current) window.clearTimeout(stopTimer.current);
    if (mediaRecorder.current?.state === "recording") mediaRecorder.current.stop();
  }
  async function approveEvidence(draft: any, index: number) {
    setActionError("");
    try {
      await api("/evidence", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          candidate_id: candidate.candidate_id,
          item: draft,
          source_text: spill,
          drafted_by: `ai:${modelName || "evidence-model"}`,
        }),
      });
      setEvidenceDrafts((current) => current.filter((_, itemIndex) => itemIndex !== index));
      await onSaved();
    } catch (error: any) {
      setActionError(error?.message || "The evidence item could not be approved.");
    }
  }
  async function scanQr(file: File) {
    setScanStatus("Reading QR…");
    try {
      const Detector = (window as any).BarcodeDetector;
      const bitmap = await createImageBitmap(file);
      let rawValue = "";
      if (Detector) {
        const codes = await new Detector({ formats: ["qr_code"] }).detect(bitmap);
        rawValue = codes[0]?.rawValue || "";
      }
      if (!rawValue) {
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("Could not read that image.");
        context.drawImage(bitmap, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
        rawValue = jsQR(pixels.data, pixels.width, pixels.height)?.data || "";
      }
      if (!rawValue) throw new Error("No QR code found in that image.");
      let candidateId = "";
      try {
        const scannedUrl = new URL(rawValue);
        candidateId = scannedUrl.searchParams.get("candidate") || "";
      } catch {
        candidateId = JSON.parse(rawValue).candidate_id || "";
      }
      if (!candidateId)
        throw new Error("That is not a Barry candidate QR code.");
      await onScan(candidateId);
      setScanStatus("Candidate loaded");
    } catch (error: any) {
      setScanStatus(error.message || "Could not read that QR code.");
    }
  }
  return (
    <div className="recruiter-workspace">
      <div className="scan-header">
        <div>
          <span className="eyebrow">Recruiter viewpoint</span>
          <h2>{candidate.full_name}</h2>
          <p>
            {candidate.short_code} ·{" "}
            {candidate.profile?.degree_field || "Degree not provided"}
          </p>
          {scanStatus && <small className="scan-status">{scanStatus}</small>}
        </div>
        <label className="recruiter-identity">Recruiter viewpoint<input value={recruiterId} onChange={(event)=>onRecruiterChange(event.target.value)} placeholder="Recruiter name or ID"/><small>Each recruiter sees and saves their own trait selections and checklist.</small></label>
        <label className="scan-button">
          <ScanLine /> Scan candidate QR
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) scanQr(file);
            }}
          />
        </label>
      </div>
      <div className="recruiter-context-photo" role="img" aria-label="A recruiter and candidate having a one-to-one career-fair conversation">
        <div><span className="eyebrow">Conversation context</span><strong>Recruiter-led. Captured while it is fresh.</strong></div>
        <span className="context-photo-credit">Photo: carmichaellibrary · <a href="https://commons.wikimedia.org/wiki/File:Career_Fair_(3344072393).jpg" target="_blank" rel="noreferrer">source</a> · <a href="https://creativecommons.org/licenses/by/2.0/" target="_blank" rel="noreferrer">CC BY 2.0</a></span>
      </div>
      <div className="capture-rail">
        <div className="capture-progress-copy">
          <span className="eyebrow">Conversation progress</span>
          <strong>{completionLabel}</strong>
        </div>
        <div className="capture-progress-bar" aria-label={`${completion}% of recruiter viewpoint captured`}>
          <i style={{ width: `${completion}%` }} />
        </div>
        <div className="capture-steps">
          <span className="done"><Check /> Facts ready</span>
          <span className={spill.trim() ? "done" : ""}><MessageSquareText /> Spill</span>
          <span className={ratedCount > 0 ? "done" : ""}><Star /> Traits selected</span>
          <span className={checklistCount === setup.checklist_items.length ? "done" : ""}><UserCheck /> Baseline checked</span>
        </div>
      </div>
      <div className="booth-grid">
        <section>
          <div className="panel profile-snapshot">
            <div className="section-heading">
              <h3>Candidate-stated facts</h3>
              <span>Self-reported</span>
            </div>
            <dl>
              <div>
                <dt>Skills</dt>
                <dd>
                  {candidate.profile?.skills?.join(", ") || "Not provided"}
                </dd>
              </div>
              <div>
                <dt>Experience</dt>
                <dd>{candidate.profile?.years_experience == null ? "Not provided" : `${candidate.profile.years_experience} years`}</dd>
              </div>
              <div>
                <dt>Technical experience</dt>
                <dd>{candidate.profile?.technical_experience_years == null ? "Not provided" : `${candidate.profile.technical_experience_years} years`} · {candidate.profile?.technical_experience_summary || "No description provided"}</dd>
              </div>
              <div>
                <dt>Work authorization</dt>
                <dd>
                  {candidate.profile?.work_authorization || "Not provided"}
                </dd>
              </div>
            </dl>
          </div>
          <div className="panel starters">
            <span className="eyebrow">Conversation starters · from confirmed candidate facts</span>
            {(candidate.conversation_starters || []).map(
              (s: string, i: number) => (
                <article key={s}>
                  <b>0{i + 1}</b>
                  <p>{s}</p>
                </article>
              ),
            )}
          </div>
          <div className="panel">
            <span className="eyebrow">Voice Spill</span>
            <h3>Talk. Barry structures the evidence.</h3>
            <p className="muted">Say what the candidate described, why you selected a trait, their role interest, and anything to clarify. No written notes are required.</p>
            <div className="spill-voice-row">
              {!recording ? (
                <button className="button voice-primary" type="button" disabled={transcribing} onClick={startVoiceCapture}>
                  {transcribing ? <RefreshCw className="spin" /> : <Mic />} {transcribing ? "Transcribing + finding evidence…" : "Start voice Spill"}
                </button>
              ) : (
                <button className="button voice-stop" type="button" onClick={stopVoiceCapture}><Square /> Stop + transcribe</button>
              )}
              <span><strong>Private by design.</strong> Audio stays on this Mac and is deleted after transcription. The transcript becomes the reason; evidence still requires approval.</span>
            </div>
            {voiceStatus && <p className={voiceStatus.includes("failed") || voiceStatus.includes("denied") ? "voice-status error" : "voice-status"}>{voiceStatus}</p>}
            {spill.trim() && <div className="voice-reason-preview"><Mic /><span><strong>Voice reason captured</strong><small>{spill}</small></span></div>}
            <details className="transcript-editor">
              <summary>Edit transcript or type instead <ChevronDown /></summary>
              <textarea
                rows={7}
                value={spill}
                onChange={(e) => {
                  setSpill(e.target.value);
                  setImpressionRationale(e.target.value);
                  setDirty(true);
                }}
                placeholder="Optional fallback: type the Spill if voice is unavailable."
              />
            </details>
            <div className="ai-boundary-note">
              <Sparkles />
              <span><strong>Local AI organizes; people decide.</strong> Llama receives only this transcript and the allowed evidence schema. Every exact quote passes deterministic safety checks, and a recruiter must approve it. AI never ranks candidates.</span>
            </div>
            <button className="button spill-model-button" type="button" disabled={!spill.trim() || aiBusy} onClick={organizeSpill}>
              {aiBusy ? <RefreshCw className="spin" /> : <Sparkles />} {aiBusy ? "Finding exact evidence…" : "Refresh evidence drafts"}
            </button>
            {reframePrompts.length > 0 && <div className="reframe-prompts" role="status"><strong>Subjective language needs evidence</strong>{reframePrompts.map((item:any,index:number)=><p key={`${item.term}-${index}`}><span>“{item.term}”</span> → {item.prompt}</p>)}</div>}
            {(modelName || evidenceDrafts.length > 0) && <div className="inline-evidence-review">
              <div className="inline-evidence-heading">
                <span><strong>Model output</strong><small>{modelName} · requires recruiter approval</small></span>
                <b>{evidenceDrafts.length} waiting</b>
              </div>
              {evidenceDrafts.length === 0 && <p className="muted">No unapproved drafts remain.</p>}
              {evidenceDrafts.map((draft, index) => <article className="inline-evidence-draft" key={`${draft.quote}-${index}`}>
                <div><span>{draft.competency_ids?.join(", ") || "evidence"}</span><span>{draft.ownership}</span></div>
                <blockquote>“{draft.quote}”</blockquote>
                <p>{draft.statement}</p>
                <div className="inline-evidence-actions">
                  <button className="button small" type="button" onClick={() => approveEvidence(draft, index)}><Check /> Approve to evidence table</button>
                  <button className="button secondary small" type="button" onClick={() => setEvidenceDrafts((current) => current.filter((_, itemIndex) => itemIndex !== index))}><X /> Reject</button>
                </div>
              </article>)}
            </div>}
          </div>
        </section>
        <section>
          <div className="panel">
            <span className="eyebrow">Your judgment</span>
            <h3>Recruiter-observed traits</h3>
            <p className="muted">
              Tap only the traits the candidate demonstrated during this
              conversation. An unselected trait means “not recorded,” not “failed.”
            </p>
            <div className="trait-threshold-note">
              <Check /> Select a trait only when the conversation gave you enough evidence to call it <strong>demonstrated</strong>.
            </div>
            <div className="human-impression-box">
              <div><strong>Recruiter first impression</strong><small>Human-owned context only · stored separately · never used in job matching</small></div>
              <div className="impression-options">{[-2,-1,0,1,2].map(score=>{const label=({"-2":"Concern","-1":"Some concerns","0":"Unclear","1":"Positive","2":"Very positive"} as any)[String(score)];return <button type="button" aria-pressed={impressionScore===score} className={impressionScore===score?"selected":""} onClick={()=>{setImpressionScore(impressionScore===score?null:score);setDirty(true)}} key={score}>{label}</button>})}</div>
              {impressionScore!=null&&<div className="impression-voice-reason"><Mic /><span><strong>Reason from Voice Spill</strong><small>{spill.trim() || impressionRationale.trim() || "Record a Voice Spill to attach an observable reason. No typing is required."}</small></span></div>}
            </div>
            <div className="trait-toggle-grid">
              {setup.traits.map((t: any) => (
                <button
                  type="button"
                  className={Number(ratings[t.trait_id]) >= 4 ? "trait-toggle selected" : "trait-toggle"}
                  aria-pressed={Number(ratings[t.trait_id]) >= 4}
                  onClick={() => {
                    setRatings((current: any) => ({
                      ...current,
                      [t.trait_id]: Number(current[t.trait_id]) >= 4 ? null : 4,
                    }));
                    setDirty(true);
                  }}
                  key={t.trait_id}
                >
                  <span className="trait-check">{Number(ratings[t.trait_id]) >= 4 ? <Check /> : null}</span>
                  <span><strong>{t.label}</strong><small>{evidenceForTrait(candidate.evidence||[],t.trait_id).length ? `${evidenceForTrait(candidate.evidence||[],t.trait_id).length} approved evidence quote(s)` : "No approved evidence yet"}</small></span>
                </button>
              ))}
            </div>
          </div>
          <div className="panel baseline">
            <span className="eyebrow">Baseline checklist</span>
            <h3>Every hire must pass</h3>
            {setup.checklist_items.map((item: any) => (
              <label
                key={item.item_id}
                className={
                  checklist[item.item_id] === true
                    ? "passed"
                    : checklist[item.item_id] === false
                      ? "failed"
                      : ""
                }
              >
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.description}</small>
                </span>
                <span className="yes-no">
                  <button
                    onClick={() =>
                      { setChecklist((x: any) => ({ ...x, [item.item_id]: true })); setDirty(true); }
                    }
                    type="button"
                  >
                    <Check /> Yes
                  </button>
                  <button
                    onClick={() =>
                      { setChecklist((x: any) => ({ ...x, [item.item_id]: false })); setDirty(true); }
                    }
                    type="button"
                  >
                    <X /> No
                  </button>
                </span>
              </label>
            ))}
          </div>
          <div className="panel">
            <span className="eyebrow">Candidate-stated interest</span>
            {setup.jobs.map((job: any) => (
              <label className="preference" key={job.job_id}>
                <input
                  type="checkbox"
                  checked={preferences.includes(job.job_id)}
                  onChange={(e) =>
                    { setPreferences(
                        e.target.checked
                          ? [...preferences, job.job_id]
                          : preferences.filter((x) => x !== job.job_id),
                      ); setDirty(true); }
                  }
                />
                {job.title}
              </label>
            ))}
          </div>
          <div className={dirty ? "capture-savebar dirty" : "capture-savebar"}>
            <span>
              <strong>{saved ? "Viewpoint saved" : dirty ? "Unsaved changes" : "Everything is up to date"}</strong>
              <small>{completionLabel} · recruiter judgment stays in control</small>
            </span>
            <button className="button save-capture" onClick={save}>
              <Save /> {saved ? "Saved" : "Save viewpoint"}
            </button>
          </div>
          {actionError && <div className="form-error" role="alert"><AlertTriangle /><span><strong>Action failed.</strong>{actionError}</span></div>}
        </section>
      </div>
    </div>
  );
}

function MatchCard({ match }: { match: any }) {
  return (
    <article className={match.excluded ? "match-card excluded" : "match-card"}>
      <div className="match-rank">
        <span>{match.excluded ? "Needs review" : `#${match.rank} job for this candidate`}</span>
        {match.preferred && <small>Candidate wants this</small>}
      </div>
      <div>
        <h3>{match.title}</h3>
        <p>{match.department}</p>
        {match.excluded ? (
          <strong className="excluded-label">
            Excluded by baseline checklist
          </strong>
        ) : (
          <div className="fit-meter rule-fit-meter">
            <span style={{ width: `${match.fit_score}%` }} />
            <b>{match.fit_score}% rule fit</b>
          </div>
        )}
      </div>
      <details>
        <summary>
          Why this result <ChevronDown />
        </summary>
        <div className="explanation">
          <div>
            <strong>Candidate facts</strong>
            <span>{match.explanation.requirements.some((item:any)=>item.met) ? "Relevant evidence found" : "More evidence needed"}</span>
          </div>
          <div>
            <strong>Recruiter-observed traits</strong>
            <span>{match.explanation.trait_alignment_status==="awaiting_recruiter_ratings"?"Awaiting recruiter selections":"Compared with this role"}</span>
          </div>
          {match.explanation.traits?.some((trait:any)=>trait.evidence_count>0) && <div className="match-evidence-links">
            <strong>Evidence behind the qualitative stance</strong>
            {match.explanation.traits.filter((trait:any)=>trait.evidence_count>0).map((trait:any)=><p key={trait.trait_id}><b>{trait.label}</b> · {trait.evidence_count} approved quote{trait.evidence_count===1?"":"s"}: “{trait.evidence_quotes[0]}”</p>)}
          </div>}
          <h5>Gaps</h5>
          {match.explanation.gaps?.length ? (
            <ul>
              {match.explanation.gaps.map((g: string) => (
                <li key={g}>{g}</li>
              ))}
            </ul>
          ) : (
            <p>No identified gaps.</p>
          )}
        </div>
      </details>
    </article>
  );
}

export function MatchReview({ setup: _setup, candidateId, onCandidateChange }: { setup: any; candidateId: string; onCandidateChange: (id:string)=>Promise<void> }) {
  const [data, setData] = useState<any>(null);
  const [selectedJobId, setSelectedJobId] = useState("");
  const load = async () => {
    const result = await api<any>("/review");
    setData(result);
  };
  useEffect(() => { load(); }, []);
  useEffect(() => { setSelectedJobId(""); }, [candidateId]);
  const candidate = data?.candidates.find((row:any)=>row.candidate_id===candidateId);
  const matches = candidate ? [...candidate.matches].sort((a:any,b:any)=>a.rank-b.rank) : [];
  const selectedMatch = matches.find((match:any)=>match.job_id===selectedJobId) || matches[0];
  async function decide(match:any, decision:"yes"|"no"|"undecided") {
    await api("/shortlist", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({candidate_id:candidateId,job_id:match.job_id,decision,recruiter_id:"rec-live"}) });
    await load();
  }
  function downloadHandoff() {
    if(!candidate) return;
    const handoff={generated_at:new Date().toISOString(),candidate:{candidate_id:candidate.candidate_id,short_code:candidate.short_code,full_name:candidate.full_name,latest_spill:candidate.latest_spill||""},recommendation:matches.find((match:any)=>match.shortlist_decision==="yes")?.title||matches.find((match:any)=>!match.excluded)?.title||"No eligible job identified",job_comparisons:matches.map((match:any)=>({rank:match.rank,job:match.title,fit_score:match.fit_score,excluded:match.excluded,candidate_preference:match.preferred,shortlist_decision:match.shortlist_decision||"undecided",quantitative_percent:match.explanation.quantitative_percent,trait_alignment:match.explanation.trait_alignment_status==="awaiting_recruiter_ratings"?"Awaiting recruiter ratings":`${match.explanation.trait_alignment_percent}%`,gaps:match.explanation.gaps}))};
    const link=document.createElement("a");link.href=URL.createObjectURL(new Blob([JSON.stringify(handoff,null,2)],{type:"application/json"}));link.download=`${candidate.short_code}-recruiter-handoff.json`;link.click();URL.revokeObjectURL(link.href);
  }
  if(!data) return <div className="empty"><RefreshCw className="spin"/><h3>Calculating transparent matches</h3></div>;
  const value = (item:any) => Array.isArray(item) ? item.join(", ") : item == null || item === "" ? "Not provided" : String(item);
  const requirements = selectedMatch?.explanation.requirements || [];
  const traits = selectedMatch?.explanation.traits || [];
  const missing = requirements.filter((row:any)=>row.status==="unknown");
  return <div className="review-page dataset-review">
    <div className="review-head dataset-review-head"><div><span className="eyebrow">Candidate-to-job comparison</span><h2>See exactly how the two datasets compare.</h2><p className="muted">Job rules and candidate records remain separate until the rule engine joins matching fields. Missing information stays missing.</p></div><button className="button secondary" onClick={downloadHandoff}><Save/> Download handoff</button></div>
    <div className="dataset-toolbar">
      <label>Candidate<select value={candidateId} onChange={event=>onCandidateChange(event.target.value)}>{data.candidates.map((row:any)=><option value={row.candidate_id} key={row.candidate_id}>{row.short_code} · {row.full_name}</option>)}</select></label>
      <label>Job being compared<select value={selectedMatch?.job_id||""} onChange={event=>setSelectedJobId(event.target.value)}>{matches.map((match:any)=><option value={match.job_id} key={match.job_id}>#{match.rank} · {match.title}{match.preferred?" · candidate preference":""}</option>)}</select></label>
      <div className="dataset-engine-note"><SlidersHorizontal/><span><strong>Deterministic comparison</strong><small>AI does not calculate this result.</small></span></div>
    </div>
    {selectedMatch&&<>
      <section className="dataset-pipeline">
        <article className="dataset-stage requirements-stage">
          <header><b>1</b><span><h3>Job requirements</h3><p>Hiring-team criteria for this role</p></span></header>
          <div className="dataset-job-title"><small>Job title</small><strong>{selectedMatch.title}</strong></div>
          <div className="dataset-table-scroll"><table><thead><tr><th>Criterion</th><th>Requirement</th><th>Class</th><th>Weight</th></tr></thead><tbody>
            {requirements.map((row:any)=><tr key={row.requirement_id}><td>{fieldLabel(row.field_key)}</td><td><strong>{operatorSymbol(row.operator)}</strong> {value(row.expected)}</td><td><span>Quantitative</span></td><td>{row.weight}</td></tr>)}
            {traits.map((row:any)=><tr key={row.trait_id}><td>{row.label}</td><td>Demonstrated</td><td><span>Qualitative</span></td><td>{row.weight}</td></tr>)}
          </tbody></table></div>
        </article>

        <article className="dataset-stage profile-stage">
          <header><b>2</b><span><h3>Candidate profile</h3><p>Raw résumé and recruiter inputs</p></span></header>
          <dl className="raw-profile-list"><div><dt>Name</dt><dd>{candidate.full_name}</dd></div><div><dt>Experience</dt><dd>{candidate.profile?.years_experience==null?"Not provided":`${candidate.profile.years_experience} years`}</dd></div><div><dt>Education</dt><dd>{candidate.profile?.degree_level||"Degree"} · {candidate.profile?.degree_field||"Not provided"}</dd></div><div><dt>Graduation</dt><dd>{candidate.profile?.expected_grad||"Not provided"}</dd></div></dl>
          <div className="raw-profile-block"><h4>Skills extracted</h4><div className="raw-skill-list">{(candidate.profile?.skills||[]).map((skill:string)=><span key={skill}>{skill}</span>)}{!candidate.profile?.skills?.length&&<em>None extracted</em>}</div></div>
          <div className="raw-profile-block"><h4>Recruiter evidence</h4><p>{candidate.latest_spill||"No Spill transcript saved."}</p><small>{candidate.evidence?.length||0} human-approved evidence quote(s)</small></div>
        </article>

        <article className="dataset-stage cleansing-stage">
          <header><b>3</b><span><h3>Clean and normalize</h3><p>Validate, standardize, and preserve unknowns</p></span></header>
          <div className="cleansing-block"><h4>Missing-data check</h4><div className="dataset-table-scroll"><table><thead><tr><th>Field</th><th>Status</th><th>Next step</th></tr></thead><tbody>{requirements.map((row:any)=><tr key={row.requirement_id}><td>{fieldLabel(row.field_key)}</td><td><span className={`dataset-status ${row.status==="unknown"?"missing":"found"}`}>{row.status==="unknown"?"Missing":"Found"}</span></td><td>{row.status==="unknown"?<b>Ask candidate</b>:"—"}</td></tr>)}</tbody></table></div></div>
          <div className="cleansing-block"><h4>Normalization applied</h4><ul><li>Experience converted to numeric years</li><li>Skills mapped to consistent names</li><li>Dates stored as YYYY-MM</li><li>Sources and confirmation state retained</li></ul></div>
          <div className="cleansing-summary"><strong>{missing.length}</strong><span>unanswered field{missing.length===1?"":"s"}<small>{missing.length?"Keep unknown until the candidate answers":"Ready for comparison"}</small></span></div>
        </article>

        <article className="dataset-stage result-stage">
          <header><b>4</b><span><h3>Match result</h3><p>Cleaned candidate data against job rules</p></span></header>
          <div className="dataset-score"><span>Overall rule fit</span><i><em style={{width:`${selectedMatch.fit_score}%`}}/></i><strong>{selectedMatch.fit_score}%</strong></div>
          <div className="dataset-table-scroll result-table"><table><thead><tr><th>Criterion</th><th>Required</th><th>Candidate</th><th>Result</th></tr></thead><tbody>
            {requirements.map((row:any)=><tr key={row.requirement_id}><td>{fieldLabel(row.field_key)}</td><td>{operatorSymbol(row.operator)} {value(row.expected)}</td><td>{value(row.actual)}</td><td className={row.status}>{row.status==="met"?<Check/>:row.status==="unknown"?<AlertTriangle/>:<X/>}</td></tr>)}
            {traits.map((row:any)=><tr key={row.trait_id}><td>{row.label}</td><td>Demonstrated</td><td>{row.rating==null?"Not observed":"Selected by recruiter"}{row.evidence_count?` · ${row.evidence_count} quote${row.evidence_count===1?"":"s"}`:""}</td><td className={row.status}>{row.status==="met"?<Check/>:row.status==="unknown"?<AlertTriangle/>:<X/>}</td></tr>)}
          </tbody></table></div>
          <div className="dataset-recommendation"><Trophy/><span><strong>{selectedMatch.excluded?"Baseline review required":selectedMatch.fit_score>=75?"Strong evidence for this role":"Recruiter review recommended"}</strong><small>{selectedMatch.excluded?"An explicit baseline failure excludes this match.":missing.length?`Comparison complete with ${missing.length} unknown field${missing.length===1?"":"s"}.`:"All required candidate fields were available for comparison."}</small></span></div>
        </article>
      </section>

      <section className="dataset-decision-bar"><div><span>Recruiter decision for {selectedMatch.title}</span><small>The rule result informs this decision; it does not make it.</small></div><div><button className={selectedMatch.shortlist_decision==="yes"?"yes active":"yes"} onClick={()=>decide(selectedMatch,"yes")}><Check/> Yes</button><button className={selectedMatch.shortlist_decision==="undecided"?"maybe active":"maybe"} onClick={()=>decide(selectedMatch,"undecided")}><AlertTriangle/> Maybe</button><button className={selectedMatch.shortlist_decision==="no"?"no active":"no"} onClick={()=>decide(selectedMatch,"no")}><X/> No</button></div></section>
      <section className="other-job-results"><div className="section-heading"><div><span className="eyebrow">Other jobs for this candidate</span><h3>Change the job above to inspect another comparison.</h3></div></div><div className="other-job-grid">{matches.map((match:any)=><button key={match.job_id} className={match.job_id===selectedMatch.job_id?"selected":""} onClick={()=>setSelectedJobId(match.job_id)}><span>#{match.rank}</span><strong>{match.title}</strong><b>{match.fit_score}%</b><small>{match.excluded?"Baseline excluded":match.preferred?"Candidate preference":"Eligible"}</small></button>)}</div></section>
    </>}
  </div>;
}

function LegacyMatchReview({ setup }: { setup: any }) {
  const [data, setData] = useState<any>(null);
  const [mode, setMode] = useState<"candidate" | "job">("candidate");
  const [candidateId, setCandidateId] = useState("");
  const [jobId, setJobId] = useState(setup.jobs[0]?.job_id || "");
  const [jobRows, setJobRows] = useState<any[]>([]);
  const [compare, setCompare] = useState<string[]>([]);
  const load = async () => {
    const r = await api<any>("/review");
    setData(r);
    if (!candidateId) setCandidateId(r.candidates[0]?.candidate_id || "");
  };
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    if (jobId) api<any[]>(`/review/jobs/${jobId}`).then(setJobRows);
  }, [jobId]);
  if (!data)
    return (
      <div className="empty">
        <RefreshCw className="spin" />
        <h3>Calculating transparent matches</h3>
      </div>
    );
  const c = data.candidates.find((x: any) => x.candidate_id === candidateId);
  const ordered = c
    ? [...c.matches].sort((a: any, b: any) => {
        if (a.rank === 1) return -1;
        if (b.rank === 1) return 1;
        if (a.preferred && !b.preferred) return -1;
        if (b.preferred && !a.preferred) return 1;
        return a.rank - b.rank;
      })
    : [];
  const comparison = jobRows.filter((r) => compare.includes(r.candidate_id));
  async function shortlist(row: any, decision: string) {
    await api("/shortlist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        candidate_id: row.candidate_id,
        job_id: jobId,
        decision,
        recruiter_id: "rec-live",
      }),
    });
    setJobRows(await api<any[]>(`/review/jobs/${jobId}`));
  }
  return (
    <div className="review-page">
      <div className="review-head">
        <div>
          <span className="eyebrow">After the fair</span>
          <h2>Explainable matches and fast decisions</h2>
        </div>
        <div className="segmented">
          <button
            className={mode === "candidate" ? "active" : ""}
            onClick={() => setMode("candidate")}
          >
            By candidate
          </button>
          <button
            className={mode === "job" ? "active" : ""}
            onClick={() => setMode("job")}
          >
            By job
          </button>
        </div>
      </div>
      {mode === "candidate" ? (
        <div className="candidate-review">
          <aside>
            <label>
              Candidate
              <select
                value={candidateId}
                onChange={(e) => setCandidateId(e.target.value)}
              >
                {data.candidates.map((x: any) => (
                  <option key={x.candidate_id} value={x.candidate_id}>
                    {x.short_code} · {x.full_name}
                  </option>
                ))}
              </select>
            </label>
            {c.latest_spill && <blockquote>{c.latest_spill}</blockquote>}
          </aside>
          <main>
            {ordered[0]?.preferred && !ordered[0]?.excluded && (
              <div className="strong-fit">
                <Trophy />
                <span>
                  <strong>Strong fit + wants this role</strong>The candidate's
                  highest-ranked match is also a stated preference.
                </span>
              </div>
            )}
            {ordered.map((m: any) => (
              <MatchCard key={m.job_id} match={m} />
            ))}
          </main>
        </div>
      ) : (
        <div>
          <div className="job-review-tools">
            <label>
              Open job
              <select
                value={jobId}
                onChange={(e) => {
                  setJobId(e.target.value);
                  setCompare([]);
                }}
              >
                {setup.jobs.map((j: any) => (
                  <option value={j.job_id} key={j.job_id}>
                    {j.title}
                  </option>
                ))}
              </select>
            </label>
            <span>{jobRows.length} candidates · ordered by rule-based fit</span>
          </div>
          <div className="cull-stack">
            {jobRows.map((row: any, index: number) => (
              <article
                key={row.candidate_id}
                className={row.excluded ? "cull-card excluded" : "cull-card"}
              >
                <label className="compare-check">
                  <input
                    type="checkbox"
                    checked={compare.includes(row.candidate_id)}
                    disabled={
                      !compare.includes(row.candidate_id) && compare.length >= 2
                    }
                    onChange={(e) =>
                      setCompare(
                        e.target.checked
                          ? [...compare, row.candidate_id]
                          : compare.filter((x) => x !== row.candidate_id),
                      )
                    }
                  />{" "}
                  Compare
                </label>
                <span className="position">#{index + 1}</span>
                <div>
                  <h3>{row.full_name}</h3>
                  <p>
                    {row.short_code} · {row.spill_note || "No Spill note"}
                  </p>
                </div>
                <div className="job-fit">
                  <strong>
                    {row.excluded ? "Excluded" : `${row.fit_score}%`}
                  </strong>
                  <small>{row.explanation.gaps?.length || 0} gaps</small>
                </div>
                <details>
                  <summary>See gaps</summary>
                  <ul>
                    {row.explanation.gaps?.map((g: string) => (
                      <li key={g}>{g}</li>
                    ))}
                  </ul>
                </details>
                <div className="cull-actions">
                  <button
                    className={
                      row.shortlist_decision === "yes" ? "yes active" : "yes"
                    }
                    onClick={() => shortlist(row, "yes")}
                  >
                    <Check /> Yes
                  </button>
                  <button
                    className={
                      row.shortlist_decision === "no" ? "no active" : "no"
                    }
                    onClick={() => shortlist(row, "no")}
                  >
                    <X /> No
                  </button>
                </div>
              </article>
            ))}
          </div>
          {comparison.length === 2 && (
            <div className="compare-panel">
              <div className="section-heading">
                <h3>Side-by-side comparison</h3>
                <button onClick={() => setCompare([])}>
                  <X />
                </button>
              </div>
              <div className="compare-grid">
                {comparison.map((r) => (
                  <div key={r.candidate_id}>
                    <h3>{r.full_name}</h3>
                    <strong>{r.fit_score}% fit</strong>
                    <p>{r.spill_note}</p>
                    <h5>Gaps</h5>
                    <ul>
                      {r.explanation.gaps?.map((g: string) => (
                        <li key={g}>{g}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DataFlowExplorer({ data }: { data: any }) {
  const [selected, setSelected] = useState("extract");
  const counts = data.status?.counts || {};
  const firstField = data.field_values?.[0];
  const firstEvidence = data.ai_evidence?.[0];
  const firstRun = data.ai_runs?.[0];
  const firstMatch = data.ranked_jobs?.[0];
  const nodes: Record<string, any> = {
    resume: { kind: "INPUT", title: "Résumé / profile", description: "The candidate supplies factual source material.", guard: "Candidate-controlled input; never treated as a qualitative score.", rows: [["stored", `${counts.candidates || 0} candidates`], ["audio", "never stored"]] },
    extract: { kind: "LOCAL AI", title: "Fact extraction", description: "Local parsing proposes structured résumé fields, work history, projects, and skills.", guard: "Missing information stays unknown and becomes a candidate question.", rows: [["field", firstField?.field_key || "No rows yet"], ["value", firstField?.value == null ? "Unknown" : String(firstField.value)], ["source", firstField?.source_kind || "—"]] },
    cleanse: { kind: "RULE", title: "Clean + normalize", description: "Types, units, aliases, dates, and duplicate values are normalized before matching.", guard: "Sensitive and unsupported fields are excluded by the field dictionary.", rows: [["confirmed", `${data.data_quality?.confirmed_fields || 0}`], ["unknown", `${data.data_quality?.unknown_fields || 0}`], ["schema", "canonical fields v1"]] },
    questions: { kind: "HUMAN", title: "Candidate confirmation", description: "Only unanswered job-relevant facts are shown to the candidate.", guard: "The candidate can confirm, correct, decline, or leave a value unknown.", rows: [["input", "missing fields only"], ["output", "confirmed facts"]] },
    voice: { kind: "INPUT", title: "Voice Spill", description: "Browser speech-to-text creates a recruiter-editable transcript during the conversation.", guard: "Raw audio is not written to SQLite.", rows: [["stored notes", `${counts.spill_notes || 0}`], ["network", "none for browser dictation"]] },
    evidence: { kind: "LOCAL AI", title: "Evidence extractor", description: "A local model maps exact transcript quotes to the fixed competency schema.", guard: "It proposes evidence only; it cannot assign trait ratings or rank candidates.", rows: [["model", firstRun?.model || "local fallback"], ["schema", firstRun?.schema_version || "evidence_v1"], ["runs", `${counts.ai_runs || 0}`]] },
    validate: { kind: "RULE", title: "Quote validator", description: "Every proposed quote must appear word-for-word in its source transcript.", guard: "Ungrounded, sensitive, and impression-only items are dropped.", rows: [["kept", `${firstRun?.kept_count ?? 0}`], ["dropped", `${firstRun?.dropped_count ?? 0}`], ["input hash", firstRun?.input_sha256 ? `${firstRun.input_sha256.slice(0, 12)}…` : "—"]] },
    approve: { kind: "HUMAN", title: "Recruiter approval", description: "The recruiter approves or rejects each evidence draft.", guard: "Nothing reaches the evidence table without a human action.", rows: [["approved evidence", `${counts.evidence || data.ai_evidence?.length || 0}`], ["review state", firstEvidence?.review_state || "—"]] },
    traits: { kind: "HUMAN", title: "Traits + checklist", description: "Recruiters record their own observation of job-specific traits and baseline items.", guard: "Human judgment remains attributable and separate from factual extraction.", rows: [["ratings", `${counts.recruiter_ratings || 0}`], ["matching role", "shown beside rules"]] },
    rules: { kind: "TABLE", title: "Job requirements", description: "Hiring-team-approved field, operator, expected value, and weight rows.", guard: "Every condition is visible and editable before the fair.", rows: [["jobs", `${counts.jobs || data.jobs?.length || 0}`], ["requirements", `${data.job_rules?.length || 0}`]] },
    match: { kind: "RULE", title: "Deterministic match", description: "The engine compares cleaned candidate fields with each open job and ranks jobs for that person.", guard: "AI does not calculate the percentage or make the decision.", rows: [["job", firstMatch?.job || "—"], ["fit", firstMatch ? `${firstMatch.fit_score}%` : "—"], ["rank", firstMatch ? `#${firstMatch.rank}` : "—"]] },
    decision: { kind: "HUMAN", title: "Recruiter decision", description: "A person records Yes, Maybe, or No and owns the follow-up.", guard: "The result informs the recruiter; it never auto-rejects a candidate.", rows: [["shortlist decisions", `${counts.shortlist_decisions || 0}`], ["audit events", `${counts.audit_events || 0}`]] },
  };
  const lanes = [
    ["Candidate facts", ["resume", "extract", "cleanse", "questions"]],
    ["Conversation", ["voice", "evidence", "validate", "approve"]],
    ["Human judgment", ["traits"]],
    ["Job comparison", ["rules", "match", "decision"]],
  ] as const;
  const node = nodes[selected];
  return <section className="pipeline-explorer">
    <div className="section-heading"><div><span className="eyebrow">Live AI + data architecture</span><h3>Every value has a source, a guardrail, and a table.</h3></div><span>Click a block to inspect it</span></div>
    <div className="pipeline-lanes">{lanes.map(([label, ids]) => <div className="pipeline-lane" key={label}><b>{label}</b><div>{ids.map((id, index) => <span className="pipeline-node-wrap" key={id}><button className={selected === id ? "pipeline-node active" : "pipeline-node"} onClick={() => setSelected(id)}><small>{nodes[id].kind}</small>{nodes[id].title}</button>{index < ids.length - 1 && <ArrowRight />}</span>)}</div></div>)}</div>
    <div className="pipeline-detail"><div><span className="pipeline-kind">{node.kind}</span><h4>{node.title}</h4><p>{node.description}</p><strong>{node.guard}</strong></div><div className="pipeline-sample"><small>LIVE DATABASE SAMPLE</small>{node.rows.map(([key, value]: string[]) => <div key={key}><code>{key}</code><span>{value}</span></div>)}</div></div>
  </section>;
}

export function DatabaseManager({ onChanged }: { onChanged: () => Promise<void> }) {
  const [data, setData] = useState<any>({ candidates: [], jobs: [] });
  const [busy, setBusy] = useState("");
  const load = async () => setData(await api<any>("/database"));
  useEffect(() => { load(); }, []);
  async function remove(kind: "candidate" | "job", id: string, label: string) {
    if (!confirm(`Delete ${label}? This removes the record and its related Barry data.`)) return;
    setBusy(id);
    try {
      await api(`/${kind === "candidate" ? "candidates" : "jobs"}/${id}`, { method: "DELETE" });
      await load();
      await onChanged();
    } finally { setBusy(""); }
  }
  async function removeResumeRow(kind:string,id:string,label:string){
    if(!confirm(`Delete ${label}? This removes only this extracted row and recalculates the candidate's job matches.`))return;
    setBusy(id);
    try{await api(`/database/rows/${kind}/${id}`,{method:"DELETE"});await load();await onChanged();}finally{setBusy("");}
  }
  async function clearField(candidateId:string,field:string,label:string){
    const key=`${candidateId}:${field}`;
    if(!confirm(`Clear ${label}? The value will become unknown and job matches will be recalculated.`))return;
    setBusy(key);
    try{await api(`/database/candidates/${candidateId}/fields/${field}`,{method:"DELETE"});await load();await onChanged();}finally{setBusy("");}
  }
  async function editField(candidateId:string,field:string,label:string,current:any){
    const value=prompt(`Edit ${label}`,current==null?"":String(current));
    if(value==null)return;
    const key=`${candidateId}:${field}`;setBusy(key);
    try{await api(`/database/candidates/${candidateId}/fields/${field}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({value})});await load();await onChanged();}finally{setBusy("");}
  }
  return <div className="database-page">
    <div className="review-head"><div><span className="eyebrow">Live SQLite data</span><h2>Database records</h2><p className="muted">These are the candidates and open jobs currently stored by Barry.</p></div><button className="scan-button" onClick={load}><RefreshCw/> Refresh</button></div>
    <section className="privacy-guardrail"><UserCheck/><span><strong>Privacy and retention guardrails</strong><small>No candidate photos, audio, GPA, or sensitive traits are stored. Recruiters can delete individual records below; rejected records should be removed under the employer's retention policy.</small></span></section>
    {data.status&&<section className="database-proof-grid">
      <div><span className="database-proof-icon connected"><Check/></span><span><strong>{data.status.engine} connected</strong><small>{data.status.database_file} · {data.status.journal_mode} journal</small></span></div>
      <div><span className="database-proof-icon"><SlidersHorizontal/></span><span><strong>{data.status.schema_tables}/{data.status.required_tables} required tables</strong><small>Foreign-key enforcement {data.status.foreign_keys?"enabled":"disabled"}</small></span></div>
      <div><span className="database-proof-icon"><Save/></span><span><strong>{data.status.counts.match_results} stored comparisons</strong><small>{data.status.counts.shortlist_decisions} shortlist decisions · {data.status.counts.spill_notes} Spill notes</small></span></div>
      <div><span className="database-proof-icon"><RefreshCw/></span><span><strong>{data.status.counts.audit_events} audit events</strong><small>Refresh to verify the latest write immediately</small></span></div>
      <div><span className="database-proof-icon"><Sparkles/></span><span><strong>{data.status.counts.ai_runs} local AI runs</strong><small>Model, schema, hash, latency, kept and dropped counts logged</small></span></div>
      <div><span className="database-proof-icon"><Check/></span><span><strong>{data.data_quality?.confirmed_fields||0} confirmed fields</strong><small>{data.data_quality?.unknown_fields||0} explicit unknowns · never converted to zero</small></span></div>
    </section>}
    {data.status && <DataFlowExplorer data={data} />}
    <section className="data-model-map">
      <div><b>Quantitative</b><span>Candidate-confirmed résumé facts</span><small>Degree · skills · experience · authorization</small></div>
      <ArrowRight/>
      <div><b>Qualitative</b><span>Recruiter-observed evidence</span><small>Selected traits · Spill · approved exact quotes</small></div>
      <ArrowRight/>
      <div><b>Comparison</b><span>Deterministic job rules</span><small>Ranks jobs for one candidate; AI does not rank</small></div>
      <ArrowRight/>
      <div><b>Decision</b><span>Recruiter-owned outcome</span><small>Yes · Maybe · No · rationale and audit</small></div>
    </section>
    <section className="database-section sql-record-section"><div className="section-heading"><div><span className="eyebrow">Type mapping and governance</span><h3>Canonical field dictionary</h3></div><span>Only job-relevant fields are allowed · sensitive fields excluded</span></div><div className="sql-table-scroll"><table className="sql-table"><thead><tr><th>Field key</th><th>Type</th><th>Unit</th><th>Privacy</th><th>Allowed conditions</th><th>Meaning</th></tr></thead><tbody>{(data.field_dictionary||[]).map((row:any)=><tr key={row.field_key}><td><code>{row.field_key}</code></td><td>{row.data_type}</td><td>{row.unit||"—"}</td><td><span className={`sql-state ${row.privacy_class}`}>{row.privacy_class}</span></td><td>{row.allowed_operators.map((value:string)=>operatorSymbol(value)).join(", ")}</td><td>{row.description}</td></tr>)}</tbody></table></div></section>
    <section className="database-section sql-record-section"><div className="section-heading"><div><span className="eyebrow">Field-level provenance</span><h3>Cleaned candidate values</h3></div><span>Typed value + source + quality state for every field</span></div><div className="sql-table-scroll"><table className="sql-table"><thead><tr><th>Candidate</th><th>Field</th><th>Type</th><th>Normalized value</th><th>Source</th><th>Quality</th></tr></thead><tbody>{(data.field_values||[]).slice(0,36).map((row:any,index:number)=><tr key={`${row.short_code}-${row.field_key}-${index}`}><td><strong>{row.full_name}</strong><small>{row.short_code}</small></td><td><code>{row.field_key}</code></td><td>{row.data_type}{row.unit?` · ${row.unit}`:""}</td><td>{row.value==null?"Unknown":Array.isArray(row.value)?row.value.join(", "):String(row.value)}</td><td>{row.source_kind}</td><td><span className={`compare-state ${row.quality_state}`}>{row.quality_state}</span></td></tr>)}</tbody></table></div></section>
    <section className="database-section sql-record-section"><div className="section-heading"><div><span className="eyebrow">Job conditional supply table</span><h3>Saved job requirements</h3></div><span>Each row is compared with the same candidate field</span></div><div className="sql-table-scroll"><table className="sql-table"><thead><tr><th>Job</th><th>Class</th><th>Candidate field</th><th>Comparison</th><th>Expected value</th><th>Meaning</th><th>Weight</th></tr></thead><tbody>{(data.job_rules||[]).map((row:any,index:number)=><tr key={`${row.job}-${row.field_key}-${index}`}><td><strong>{row.job}</strong></td><td><span className="sql-state">Quantitative</span></td><td>{fieldLabel(row.field_key)}</td><td><strong title={row.operator}>{operatorSymbol(row.operator)}</strong></td><td>{Array.isArray(row.expected)?row.expected.join(", "):String(row.expected)}</td><td>{row.label}</td><td>{row.weight}</td></tr>)}</tbody></table></div></section>
    <section className="database-section sql-record-section"><div className="section-heading"><div><span className="eyebrow">Candidate table</span><h3>Quantitative fields</h3></div><span>Click a value to edit it · trash clears only that field</span></div><div className="sql-table-scroll"><table className="sql-table editable-sql-table"><thead><tr><th>Candidate</th><th>Degree</th><th>Graduation</th><th>Experience</th><th>Technical</th><th>Authorization</th></tr></thead><tbody>{(data.quantitative||[]).slice(0,12).map((row:any)=><tr key={row.candidate_id}><td><strong>{row.full_name}</strong><small>{row.short_code}</small></td><td><span className="editable-field" onClick={()=>editField(row.candidate_id,"degree_field",`${row.full_name}'s degree`,row.degree_field)}>{row.degree_field||"Unknown"}</span>{row.degree_field&&<button title="Clear degree" disabled={busy===`${row.candidate_id}:degree_field`} onClick={()=>clearField(row.candidate_id,"degree_field",`${row.full_name}'s degree`)}><Trash2/></button>}</td><td><span className="editable-field" onClick={()=>editField(row.candidate_id,"expected_grad",`${row.full_name}'s graduation date`,row.expected_grad)}>{row.expected_grad||"Unknown"}</span>{row.expected_grad&&<button title="Clear graduation" disabled={busy===`${row.candidate_id}:expected_grad`} onClick={()=>clearField(row.candidate_id,"expected_grad",`${row.full_name}'s graduation date`)}><Trash2/></button>}</td><td><span className="editable-field" onClick={()=>editField(row.candidate_id,"years_experience",`${row.full_name}'s experience`,row.years_experience)}>{row.years_experience==null?"Unknown":`${row.years_experience} years`}</span>{row.years_experience!=null&&<button title="Clear experience" disabled={busy===`${row.candidate_id}:years_experience`} onClick={()=>clearField(row.candidate_id,"years_experience",`${row.full_name}'s experience`)}><Trash2/></button>}</td><td><span className="editable-field" onClick={()=>editField(row.candidate_id,"technical_experience_years",`${row.full_name}'s technical experience`,row.technical_experience_years)}>{row.technical_experience_years==null?"Unknown":`${row.technical_experience_years} years`}</span>{row.technical_experience_years!=null&&<button title="Clear technical experience" disabled={busy===`${row.candidate_id}:technical_experience_years`} onClick={()=>clearField(row.candidate_id,"technical_experience_years",`${row.full_name}'s technical experience`)}><Trash2/></button>}</td><td><span className="editable-field" onClick={()=>editField(row.candidate_id,"work_authorization",`${row.full_name}'s work authorization`,row.work_authorization)}>{row.work_authorization||"Unknown"}</span>{row.work_authorization&&<button title="Clear authorization" disabled={busy===`${row.candidate_id}:work_authorization`} onClick={()=>clearField(row.candidate_id,"work_authorization",`${row.full_name}'s work authorization`)}><Trash2/></button>}</td></tr>)}</tbody></table></div></section>
    <section className="database-section sql-record-section"><div className="section-heading"><div><span className="eyebrow">Normalized résumé rows</span><h3>Work experience</h3></div><span>Every parsed role can be deleted separately</span></div><div className="sql-table-scroll"><table className="sql-table"><thead><tr><th>Candidate</th><th>Role</th><th>Organization</th><th>Dates</th><th>Responsibilities</th><th/></tr></thead><tbody>{(data.resume_experience||[]).slice(0,24).map((row:any)=><tr key={row.experience_id}><td><strong>{row.full_name}</strong><small>{row.short_code}</small></td><td>{row.role_title||"Unclear"}</td><td>{row.organization||"Unclear"}</td><td>{[row.start_date,row.end_date].filter(Boolean).join(" – ")||"Unclear"}</td><td>{row.description||row.source_text}</td><td><button className="row-delete" title="Delete experience row" disabled={busy===row.experience_id} onClick={()=>removeResumeRow("experience",row.experience_id,`${row.full_name}'s ${row.role_title||"experience"}`)}><Trash2/></button></td></tr>)}</tbody></table></div></section>
    <section className="database-section sql-record-section"><div className="section-heading"><div><span className="eyebrow">Normalized résumé rows</span><h3>Skills</h3></div><span>One deletable skill per SQL row</span></div><div className="sql-table-scroll"><table className="sql-table"><thead><tr><th>Candidate</th><th>Skill</th><th>Source</th><th>Candidate confirmed</th><th/></tr></thead><tbody>{(data.resume_skills||[]).slice(0,40).map((row:any)=><tr key={row.skill_id}><td><strong>{row.full_name}</strong><small>{row.short_code}</small></td><td>{row.skill}</td><td>{row.source}</td><td>{row.confirmed?"Yes":"Pending confirmation"}</td><td><button className="row-delete" title="Delete skill row" disabled={busy===row.skill_id} onClick={()=>removeResumeRow("skill",row.skill_id,`${row.full_name}'s ${row.skill} skill`)}><Trash2/></button></td></tr>)}</tbody></table></div></section>
    <section className="database-section sql-record-section"><div className="section-heading"><div><span className="eyebrow">Normalized résumé rows</span><h3>Projects</h3></div><span>Project evidence and technologies</span></div><div className="sql-table-scroll"><table className="sql-table"><thead><tr><th>Candidate</th><th>Project</th><th>Description</th><th>Skills</th><th/></tr></thead><tbody>{(data.resume_projects||[]).slice(0,24).map((row:any)=><tr key={row.project_id}><td><strong>{row.full_name}</strong><small>{row.short_code}</small></td><td>{row.name||"Résumé project"}</td><td>{row.description}</td><td>{row.skills?.join(", ")||"None detected"}</td><td><button className="row-delete" title="Delete project row" disabled={busy===row.project_id} onClick={()=>removeResumeRow("project",row.project_id,`${row.full_name}'s ${row.name||"project"}`)}><Trash2/></button></td></tr>)}</tbody></table></div></section>
    <section className="database-section sql-record-section"><div className="section-heading"><div><span className="eyebrow">Recruiter observations table</span><h3>Qualitative fields</h3></div><span>Human stance + approved exact-quote support</span></div><div className="sql-table-scroll"><table className="sql-table"><thead><tr><th>Candidate</th><th>Observed trait</th><th>Stored state</th><th>Evidence support</th><th>Recruiter</th><th>Timestamp</th></tr></thead><tbody>{(data.qualitative||[]).slice(0,18).map((row:any,index:number)=><tr key={`${row.short_code}-${row.trait}-${index}`}><td><strong>{row.full_name}</strong><small>{row.short_code}</small></td><td>{row.trait}</td><td><span className="sql-state">{row.observation}</span></td><td>{row.evidence_count?<><strong>{row.evidence_count} approved</strong><small>“{row.evidence_quotes[0]}”</small></>:<span className="compare-state unknown">Needs evidence</span>}</td><td>{row.recruiter_id}</td><td>{new Date(row.created_at).toLocaleString()}</td></tr>)}</tbody></table></div></section>
    <section className="database-section sql-record-section"><div className="section-heading"><div><span className="eyebrow">Human-approved model output</span><h3>AI evidence table</h3></div><span>Exact quotes only</span></div><div className="sql-table-scroll"><table className="sql-table"><thead><tr><th>Candidate</th><th>Competencies</th><th>Exact quote</th><th>Strength / ownership</th><th>Model provenance</th><th>Review</th></tr></thead><tbody>{(data.ai_evidence||[]).slice(0,14).map((row:any,index:number)=><tr key={`${row.short_code}-${index}`}><td><strong>{row.full_name}</strong><small>{row.short_code}</small></td><td>{row.competency_ids||"Uncategorized"}</td><td className="quote-cell">“{row.quote}”</td><td>{row.strength} · {row.ownership}</td><td>{row.drafted_by}</td><td><span className="sql-state">{row.review_state}</span></td></tr>)}</tbody></table></div></section>
    <section className="database-section sql-record-section"><div className="section-heading"><div><span className="eyebrow">Subjectivity is isolated</span><h3>Recruiter impression table</h3></div><span>Recorded, attributable, and excluded from deterministic matching</span></div><div className="sql-table-scroll"><table className="sql-table"><thead><tr><th>Candidate</th><th>Recruiter</th><th>Human label</th><th>Internal score</th><th>Rationale</th><th>Matching</th></tr></thead><tbody>{(data.impressions||[]).slice(0,18).map((row:any,index:number)=><tr key={`${row.short_code}-${row.recruiter_id}-${index}`}><td><strong>{row.full_name}</strong><small>{row.short_code}</small></td><td>{row.recruiter_id}</td><td>{row.impression_label}</td><td>{row.impression_score}</td><td>{row.rationale||"No rationale"}</td><td><span className="compare-state confirmed">Excluded</span></td></tr>)}</tbody></table></div></section>
    <section className="database-section sql-record-section"><div className="section-heading"><div><span className="eyebrow">AI observability</span><h3>Local model run ledger</h3></div><span>No raw audio stored · input represented by SHA-256</span></div><div className="sql-table-scroll"><table className="sql-table"><thead><tr><th>Task</th><th>Model / prompt</th><th>Schema</th><th>Input hash</th><th>Kept / dropped</th><th>Latency</th><th>Mode</th></tr></thead><tbody>{(data.ai_runs||[]).map((row:any)=><tr key={row.run_id}><td>{row.task}</td><td><strong>{row.model}</strong><small>{row.prompt_version}</small></td><td>{row.schema_version}</td><td><code>{row.input_sha256.slice(0,12)}…</code><small>{row.input_characters} text characters</small></td><td>{row.kept_count} / {row.dropped_count}</td><td>{row.latency_ms} ms</td><td><span className={`compare-state ${row.fallback?"unknown":"met"}`}>{row.fallback?"Fallback":"Local model"}</span></td></tr>)}</tbody></table></div></section>
    <section className="database-section sql-record-section"><div className="section-heading"><div><span className="eyebrow">Rule engine output</span><h3>Ranked jobs per candidate</h3></div><span>AI does not produce this ranking</span></div><div className="sql-table-scroll"><table className="sql-table"><thead><tr><th>Candidate</th><th>Job rank</th><th>Job</th><th>Rule fit</th><th>Baseline</th><th>Calculated</th></tr></thead><tbody>{(data.ranked_jobs||[]).slice(0,20).map((row:any,index:number)=><tr key={`${row.short_code}-${row.job}-${index}`}><td><strong>{row.full_name}</strong><small>{row.short_code}</small></td><td><b>#{row.rank}</b></td><td>{row.job}</td><td><span className="matrix-score">{row.fit_score}%</span></td><td>{row.excluded?"Excluded by recorded failure":"Eligible"}</td><td>{new Date(row.calculated_at).toLocaleString()}</td></tr>)}</tbody></table></div></section>
    <section className="database-section danger-records"><div className="section-heading"><h3>Entire candidate records</h3><span>{data.candidates.length} records · deletion is permanent</span></div><div className="data-table"><div className="data-row data-head"><span>ID</span><span>Candidate</span><span>Status</span><span>Added</span><span/></div>{data.candidates.map((candidate:any)=><div className="data-row" key={candidate.candidate_id}><code>{candidate.short_code}</code><span><strong>{candidate.full_name}</strong><small>{candidate.email}</small></span><span className={candidate.scan_complete?"record-status complete":"record-status"}>{candidate.scan_complete?"Complete":"Needs gaps"}</span><time>{new Date(candidate.created_at).toLocaleDateString()}</time><button className="delete-record" disabled={busy===candidate.candidate_id} onClick={()=>remove("candidate",candidate.candidate_id,`ENTIRE candidate ${candidate.full_name}`)}><Trash2/> Delete entire candidate</button></div>)}</div></section>
    <section className="database-section"><div className="section-heading"><h3>Posted jobs</h3><span>{data.jobs.length} records</span></div><div className="data-table jobs-table"><div className="data-row data-head"><span>Department</span><span>Job</span><span>Status</span><span>Added</span><span/></div>{data.jobs.map((job:any)=><div className="data-row" key={job.job_id}><span>{job.department}</span><span><strong>{job.title}</strong><small>{job.job_id}</small></span><span className="record-status complete">{job.status}</span><time>{new Date(job.created_at).toLocaleDateString()}</time><button className="delete-record" disabled={busy===job.job_id} onClick={()=>remove("job",job.job_id,job.title)}><Trash2/> Delete</button></div>)}</div></section>
  </div>;
}
