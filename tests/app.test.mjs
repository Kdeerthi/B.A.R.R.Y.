import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { bootstrap, clearCandidateProfileField, createCandidate, createOrUpdateCandidateFromResume, createJob, databaseSnapshot, databaseStatus, db, deleteCandidate, deleteCandidateProfileRow, deleteJob, ensureSeeded, finalizeCandidate, getCandidate, insertEvidence, matchingSetup, recruiterCapture, recordAiRun, resetAndSeed, saveShortlist, studyList } from "../../server/db.mjs";
import { extractDebrief } from "../../server/extract.mjs";
import { parseResume } from "../../server/resume.mjs";
import { parseJobDescription } from "../../server/job-description.mjs";
import { evaluateRequirement } from "../../server/matching.mjs";
import { evidenceSchema, normalizeModelEvidence } from "../../server/local-ai.mjs";
import { parseJobDocuments } from "../../server/document-intake.mjs";

ensureSeeded();
resetAndSeed();

test("SQLite is seeded with the frozen demo fixtures", () => {
  const data = bootstrap();
  assert.equal(data.candidates.length, 62);
  assert.equal(data.jobs.length, 2);
  assert.equal(data.study.case_count, 24);
});

test("the unified workflow has every required SQL table and seeded setup data", () => {
  const required = ["candidates","jobs","job_requirements","traits","checklist_items","recruiter_ratings","spill_notes","candidate_preferences","match_results","shortlist_decisions","field_dictionary","candidate_field_values","recruiter_impressions","ai_runs"];
  const actual = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view')").all().map(row => row.name));
  for (const table of required) assert.ok(actual.has(table), table);
  const setup = matchingSetup();
  assert.equal(setup.jobs.length, 4);
  assert.ok(setup.traits.length >= 7);
  assert.ok(setup.checklist_items.length >= 4);
});

test("the Node backend reports a healthy enforced SQLite connection", () => {
  const status = databaseStatus();
  assert.equal(status.connected, true);
  assert.equal(status.engine, "SQLite");
  assert.equal(status.foreign_keys, true);
  assert.equal(status.journal_mode, "WAL");
  assert.equal(status.schema_tables, status.required_tables);
  assert.ok(status.counts.candidates >= 10);
  assert.ok(status.counts.jobs >= 3);
  assert.ok(status.counts.match_results > 0);
});

test("the database screen receives populated quantitative, qualitative, evidence, and ranking rows", () => {
  const snapshot = databaseSnapshot();
  assert.ok(snapshot.quantitative.length > 0);
  assert.ok(snapshot.qualitative.length > 0);
  assert.ok(snapshot.ai_evidence.length > 0);
  assert.ok(snapshot.ranked_jobs.length > 0);
  assert.ok(snapshot.job_rules.length > 0);
  assert.ok(snapshot.resume_skills.length > 0);
  assert.ok(snapshot.resume_experience.length > 0);
  assert.ok(snapshot.resume_projects.length > 0);
  assert.ok(snapshot.field_dictionary.length >= 10);
  assert.ok(snapshot.field_values.length > 0);
  assert.ok(snapshot.impressions.length > 0);
  assert.ok(snapshot.data_quality.confirmed_fields > 0);
  assert.equal(typeof snapshot.quantitative[0].full_name, "string");
  assert.equal(typeof snapshot.qualitative[0].trait, "string");
  assert.equal(typeof snapshot.ai_evidence[0].quote, "string");
  assert.equal(typeof snapshot.ranked_jobs[0].rank, "number");
});

test("resume parsing extracts facts and identifies only unanswered required fields", () => {
  const result = parseResume("Jordan Lee\njordan@example.test\n555-010-2020\nB.S. in Computer Science expected May 2027\nSkills: Python, SQL\nTwo years of project experience.");
  assert.equal(result.profile.full_name, "Jordan Lee");
  assert.equal(result.profile.degree_field, "Computer Science");
  assert.equal(result.profile.years_experience, 2);
  assert.deepEqual(result.profile.skills.sort(), ["Python","SQL"]);
  assert.ok(result.gaps.includes("technical_experience_years"));
  assert.ok(result.gaps.includes("technical_experience_summary"));
  assert.ok(result.gaps.includes("work_authorization"));
});

test("resume extraction answers every supported intake question when evidence is present", () => {
  const result = parseResume(`Jordan Lee
jordan@example.test | 555-010-2020
EDUCATION
B.S. in Computer Science
Expected May 2027
EXPERIENCE
Software Intern | Jan 2025 - Dec 2026
Built a Python dashboard and tested a SQL API.
SKILLS
Python, SQL, Tableau
U.S. Citizen`);
  assert.equal(result.profile.expected_grad, "2027-05");
  assert.deepEqual(result.profile.skills.sort(), ["Python","SQL","Tableau"].sort());
  assert.equal(result.profile.years_experience, 2);
  assert.equal(result.profile.technical_experience_years, 2);
  assert.equal(result.profile.work_experience.length, 1);
  assert.equal(result.profile.work_experience_count, 1);
  assert.equal(result.profile.skill_count, 3);
  assert.deepEqual(result.profile.hard_skills.sort(), ["Python","SQL","Tableau"].sort());
  assert.equal(result.extraction.summary.total_years, 2);
  assert.equal(result.extraction.summary.extracted_job_experience.length, 1);
  assert.equal(result.profile.work_authorization, "U.S. citizen");
  assert.equal(result.gaps.length, 0);
  assert.equal(result.extraction.extracted_count, 10);
});

test("a new resume creates a candidate while the same person's later resume updates that record", () => {
  const first=createOrUpdateCandidateFromResume({
    full_name:"Upload Test Candidate",email:"upload-test@example.test",resume_text:"Upload Test Candidate upload-test@example.test Skills: SQL",
    profile:{full_name:"Upload Test Candidate",email:"upload-test@example.test",skills:["SQL"],work_experience:[]},scan_complete:false,
  });
  const second=createOrUpdateCandidateFromResume({
    full_name:"Upload Test Candidate",email:"upload-test@example.test",resume_text:"Upload Test Candidate upload-test@example.test Skills: SQL, Python",
    profile:{full_name:"Upload Test Candidate",email:"upload-test@example.test",skills:["SQL","Python"],work_experience:[]},scan_complete:false,
  });
  assert.equal(first.updated_existing,false);
  assert.equal(second.updated_existing,true);
  assert.equal(second.candidate_id,first.candidate_id);
  assert.deepEqual(getCandidate(first.candidate_id).profile.skills,["SQL","Python"]);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM candidate WHERE email_norm=?").get("upload-test@example.test").n,1);
  deleteCandidate(first.candidate_id);
});

test("multiple TXT job descriptions parse independently and remain drafts until human approval", async () => {
  const before = db.prepare("SELECT COUNT(*) AS n FROM jobs").get().n;
  const result = await parseJobDocuments([
    { file_name:"analyst.txt", mime_type:"text/plain", text:"Role: Data Analyst\nRequires 2+ years of technical experience, SQL, and a Bachelor's degree in Statistics." },
    { file_name:"engineer.txt", mime_type:"text/plain", content_base64:Buffer.from("Role: Software Engineer\nRequires 3+ years of technical experience using Java and AWS.").toString("base64") },
    { file_name:"bad.exe", mime_type:"application/octet-stream", content_base64:"AA==" },
  ]);
  assert.equal(result.files_received, 3);
  assert.equal(result.succeeded, 2);
  assert.equal(result.failed, 1);
  assert.equal(result.approval_required, true);
  assert.equal(result.results[0].persisted, false);
  assert.ok(result.results[0].draft.requirements.some((item) => item.field_key === "skills" && item.expected === "SQL"));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM jobs").get().n, before);
});

test("combined experience and projects sections retain all project rows", () => {
  const fixture = JSON.parse(fs.readFileSync(path.resolve("data/candidates.json"), "utf8"))[0];
  const result = parseResume(fixture.resume_text);
  assert.ok(result.profile.projects.length >= 2);
  assert.ok(result.profile.projects.some(project => /study-room booking app/i.test(project.name)));
  assert.equal(result.profile.projects.some(project => /^Languages:/i.test(project.name)), false);
});

test("missing résumé evidence stays unknown and becomes a candidate question", () => {
  const result = parseResume("Alex Morgan\nalex@example.test\nSkills: Excel");
  assert.equal(result.profile.years_experience, null);
  assert.equal(result.profile.technical_experience_years, null);
  assert.ok(result.gaps.includes("phone"));
  assert.ok(result.gaps.includes("expected_grad"));
  assert.ok(result.gaps.includes("years_experience"));
  assert.ok(result.gaps.includes("work_authorization"));
});

test("ordinary words beginning with ba are not mistaken for a degree", () => {
  const result = parseResume("Jordan Lee\njordan@example.test\nBased in Arkansas and able to deliver solutions that create value.");
  assert.equal(result.profile.degree_field, "");
  assert.ok(result.gaps.includes("degree_field"));
});

test("typing work-experience years finalizes safely without corrupting normalized rows", () => {
  const created=createCandidate({full_name:"Numeric Test",email:"numeric.test@example.test",resume_text:"Numeric Test",profile:{full_name:"Numeric Test",email:"numeric.test@example.test",skills:[],work_experience:"temporarily malformed",education_history:[],projects:[],certifications:[],links:[]}});
  assert.doesNotThrow(()=>finalizeCandidate(created.candidate_id,{years_experience:"2.5",technical_experience_years:"1"}));
  const saved=getCandidate(created.candidate_id);
  assert.equal(saved.profile.years_experience,2.5);
  assert.equal(saved.profile.technical_experience_years,1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM candidate_experience WHERE candidate_id=?").get(created.candidate_id).count,0);
  deleteCandidate(created.candidate_id);
});

test("a pasted job paragraph becomes recruiter-reviewable rule and trait drafts", () => {
  const draft = parseJobDescription("Role: Data Analyst. Requires 2+ years of technical experience using SQL, Python, Excel, and Tableau. Computer Science or Data Science degree preferred. Collaborate with stakeholders and communicate findings.");
  assert.equal(draft.title, "Data Analyst");
  assert.ok(draft.requirements.some(rule => rule.field_key === "skills" && rule.expected.includes("SQL")));
  assert.equal(draft.requirements.find(rule => rule.field_key === "skills").expected.includes("R"), false);
  assert.ok(draft.requirements.some(rule => rule.field_key === "technical_experience_years" && rule.expected === 2));
  assert.ok(draft.requirements.some(rule => rule.field_key === "degree_field"));
  assert.ok(draft.traits.some(trait => trait.trait_id === "collaboration"));
  assert.equal(draft.provenance.mode, "draft_only");
});

test("a detailed requisition becomes many atomic conditions instead of one weak skill bundle", () => {
  const draft=parseJobDescription("Data Scientist. Proficiency with data mining and statistical analysis. Experience with Excel, PowerPoint, Tableau, SQL, Java, Python, and SAS. Bachelor's degree in statistics or mathematics. Two or more years of project management experience. Professional certification required.");
  assert.ok(draft.requirements.length>=12);
  assert.ok(draft.requirements.filter(rule=>rule.operator==="has_skill").length>=8);
  assert.ok(draft.requirements.some(rule=>rule.field_key==="project_management_experience_years"&&rule.expected===2));
  assert.ok(draft.requirements.some(rule=>rule.field_key==="certifications"));
});

test("expected-graduation rules compare YYYY-MM values in either direction", () => {
  const base = { requirement_id: "grad", label: "Graduates after May 2027", field_key: "expected_grad", expected_json: JSON.stringify("2027-05"), weight: 1 };
  assert.equal(evaluateRequirement({ expected_grad: "2027-12" }, { ...base, operator: "on_or_after" }).met, true);
  assert.equal(evaluateRequirement({ expected_grad: "2027-04" }, { ...base, operator: "on_or_after" }).met, false);
  assert.equal(evaluateRequirement({ expected_grad: "2027-04" }, { ...base, operator: "on_or_before" }).met, true);
  assert.equal(evaluateRequirement({ expected_grad: "" }, { ...base, operator: "on_or_after" }).met, false);
});

test("at-most rules use a visible less-than-or-equal comparison", () => {
  const rule = { requirement_id:"travel", label:"Travel up to 25%", field_key:"travel_percent", operator:"lte", expected_json:"25", weight:1 };
  assert.equal(evaluateRequirement({travel_percent:20},rule).met,true);
  assert.equal(evaluateRequirement({travel_percent:30},rule).met,false);
});

test("missing comparison data remains explicitly unknown", () => {
  const result = evaluateRequirement({}, { requirement_id:"r-unknown", field_key:"years_experience", operator:"gte", expected_json:"3", label:"Experience", weight:1 });
  assert.equal(result.status, "unknown");
  assert.equal(result.met, false);
});

test("match results rank jobs and retain a field-level explanation", () => {
  const candidate = getCandidate(bootstrap().candidates[0].candidate_id);
  assert.equal(candidate.matches.length, 4);
  assert.deepEqual(candidate.matches.map(row => row.rank), [1,2,3,4]);
  assert.ok(candidate.matches[0].explanation.formula.includes("60%"));
  assert.ok(candidate.matches[0].explanation.requirements.every(item => typeof item.met === "boolean"));
});

test("only an explicit checklist failure excludes a match", () => {
  const unknown = db.prepare("SELECT COUNT(*) AS n FROM match_results WHERE excluded=1 AND candidate_id NOT IN (SELECT candidate_id FROM checklist_ratings WHERE passed=0)").get();
  assert.equal(unknown.n, 0);
  const explicit = db.prepare("SELECT COUNT(*) AS n FROM match_results WHERE excluded=1 AND candidate_id IN (SELECT candidate_id FROM checklist_ratings WHERE passed=0)").get();
  assert.ok(explicit.n > 0);
});

test("every pre-generated candidate has synthetic demo trait ratings", () => {
  const missing = db.prepare("SELECT COUNT(*) AS n FROM candidate c WHERE NOT EXISTS (SELECT 1 FROM recruiter_ratings r WHERE r.candidate_id=c.candidate_id)").get();
  assert.equal(missing.n, 0);
  const incomplete = db.prepare("SELECT COUNT(*) AS n FROM candidate c WHERE (SELECT COUNT(*) FROM recruiter_ratings r WHERE r.candidate_id=c.candidate_id) < (SELECT COUNT(*) FROM traits)").get();
  assert.equal(incomplete.n, 0);
});

test("one-tap recruiter traits persist only selected demonstrated traits at the shared threshold", () => {
  const candidateId = bootstrap().candidates[0].candidate_id;
  recruiterCapture({
    candidate_id: candidateId,
    recruiter_id: "rec-test",
    ratings: { collaboration: 4, adaptability: null, communication: 3 },
    checklist: {},
    spill: "",
    preferences: [],
  });
  const rows = db.prepare("SELECT trait_id,rating FROM recruiter_ratings WHERE candidate_id=? AND recruiter_id='rec-test'").all(candidateId).map(row => ({ trait_id: row.trait_id, rating: row.rating }));
  assert.deepEqual(rows, [{ trait_id: "collaboration", rating: 4 }]);
  assert.ok(db.prepare("SELECT COUNT(*) AS n FROM recruiter_ratings WHERE candidate_id=? AND recruiter_id<>'rec-test'").get(candidateId).n > 0, "another recruiter's viewpoint remains intact");
  resetAndSeed();
});

test("job creation rejects unknown fields and incompatible conditions before writing SQL rows", () => {
  const before = db.prepare("SELECT COUNT(*) AS n FROM jobs").get().n;
  assert.throws(() => createJob({title:"Invalid field test",requirements:[{field_key:"favorite_color",operator:"gte",expected:2,label:"Invalid",weight:1}]}), /Unsupported candidate field/);
  assert.throws(() => createJob({title:"Invalid operator test",requirements:[{field_key:"skills",operator:"gte",expected:2,label:"Invalid",weight:1}]}), /not valid for skills/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM jobs").get().n, before);
});

test("multiple recruiter viewpoints combine deterministically and preserve explicit baseline failures", () => {
  const created = createCandidate({full_name:"Aggregation Test",email:"aggregation@example.test",profile:{full_name:"Aggregation Test",email:"aggregation@example.test",skills:["SQL"],years_experience:2,technical_experience_years:1},scan_complete:true});
  recruiterCapture({candidate_id:created.candidate_id,recruiter_id:"rec-a",ratings:{problem_solving:4},checklist:{integrity:true},preferences:[]});
  recruiterCapture({candidate_id:created.candidate_id,recruiter_id:"rec-b",ratings:{problem_solving:4},checklist:{integrity:false},preferences:[]});
  const row = db.prepare("SELECT excluded,explanation_json FROM match_results WHERE candidate_id=? ORDER BY rank LIMIT 1").get(created.candidate_id);
  const explanation = JSON.parse(row.explanation_json);
  assert.equal(row.excluded, 1);
  assert.equal(explanation.traits.find(item => item.trait_id === "problem_solving")?.recruiter_count, 2);
  assert.equal(explanation.checklist.find(item => item.item_id === "integrity")?.passed, false);
  assert.equal(explanation.checklist.find(item => item.item_id === "integrity")?.recruiter_count, 2);
  deleteCandidate(created.candidate_id);
});

test("approved Voice Spill evidence is attached to the recruiter trait stance and match explanation", () => {
  const created = createCandidate({full_name:"Voice Evidence Test",email:"voice-evidence@example.test",profile:{full_name:"Voice Evidence Test",email:"voice-evidence@example.test",skills:["SQL"],years_experience:2,technical_experience_years:1},scan_complete:true});
  const spill = "I built a SQL dashboard and tested it with the operations team.";
  const draft = extractDebrief(spill).kept[0];
  insertEvidence(created.candidate_id,draft,spill,"local-voice-test");
  recruiterCapture({candidate_id:created.candidate_id,recruiter_id:"voice-recruiter",ratings:{problem_solving:4},checklist:{integrity:true},spill,preferences:[],impression:{score:1,label:"Positive",rationale:spill}});
  const match = db.prepare("SELECT explanation_json FROM match_results WHERE candidate_id=? AND job_id='job-swe-intern'").get(created.candidate_id);
  const problemSolving = JSON.parse(match.explanation_json).traits.find(item=>item.trait_id==="problem_solving");
  assert.ok(problemSolving.evidence_count >= 1);
  assert.ok(problemSolving.evidence_quotes.some(quote=>spill.includes(quote)));
  const row = databaseSnapshot().qualitative.find(item=>item.candidate_id===created.candidate_id&&item.trait_id==="problem_solving");
  assert.ok(row.evidence_count >= 1);
  assert.equal(db.prepare("SELECT rationale FROM recruiter_impressions WHERE candidate_id=? AND recruiter_id='voice-recruiter'").get(created.candidate_id).rationale,spill);
  deleteCandidate(created.candidate_id);
});

test("shortlist decisions validate their controlled vocabulary", () => {
  const candidateId = bootstrap().candidates[0].candidate_id;
  const jobId = matchingSetup().jobs[0].job_id;
  assert.throws(() => saveShortlist({candidate_id:candidateId,job_id:jobId,decision:"absolutely"}), /yes, no, or undecided/);
});

test("candidate API model never exposes test metadata", () => {
  const data = bootstrap();
  const candidate = getCandidate(data.hero_candidate_id);
  assert.ok(candidate);
  assert.equal("test_meta" in candidate, false);
  assert.equal(JSON.stringify(candidate).includes("study_pair_type"), false);
});

test("every displayed evidence quote is grounded in its stored source", () => {
  for (const row of db.prepare("SELECT e.evidence_id,e.quote,s.body FROM evidence e JOIN source s ON s.source_id=e.source_id WHERE e.review_state IN ('approved','edited')").all()) {
    assert.ok(row.body.includes(row.quote), `${row.evidence_id} quote was not found in its source`);
  }
});

test("deterministic debrief extraction keeps evidence and redirects impressions", () => {
  const text = "She said she built the login flow and wrote the unit tests; a teammate did the UI. Seemed super confident.";
  const result = extractDebrief(text);
  assert.equal(result.kept.length, 3);
  assert.ok(result.prompts.some(p => p.term === "confident"));
  assert.equal(result.dropped.length, 0);
});

test("Spill extraction organizes a previously unseen action sentence as grounded evidence", () => {
  const text = "I analyzed shipment delays in Excel and built a dashboard for the operations team.";
  const result = extractDebrief(text);
  assert.equal(result.kept.length, 1);
  assert.equal(result.kept[0].quote, text);
  assert.equal(result.kept[0].ownership, "individual");
});

test("impression-only insulting Spill text produces no candidate evidence", () => {
  const text = "Chelsea is a questionable person because she thinks she's all that. She is smart but sometimes smart people are still dumb.";
  const result = extractDebrief(text);
  assert.equal(result.kept.length, 0);
});

test("an approved Spill draft becomes a traceable qualitative evidence row", () => {
  const candidateId = bootstrap().candidates[0].candidate_id;
  const spill = "She said she built the login flow and wrote the unit tests; a teammate did the UI.";
  const draft = extractDebrief(spill).kept[0];
  const evidenceId = insertEvidence(candidateId, draft, spill, "deterministic-demo@debrief-v1");
  const row = db.prepare(`SELECT e.quote,e.drafted_by,e.review_state,s.body
    FROM evidence e JOIN source s ON s.source_id=e.source_id WHERE e.evidence_id=?`).get(evidenceId);
  assert.equal(row.review_state, "approved");
  assert.equal(row.drafted_by, "deterministic-demo@debrief-v1");
  assert.ok(row.body.includes(row.quote));
  resetAndSeed();
});

test("local Spill AI has a strict evidence schema and deterministic ownership correction", () => {
  assert.deepEqual(evidenceSchema.properties.evidence.items.properties.strength.enum, ["claimed", "described"]);
  const source = "I built a SQL dashboard and tested it with the operations team.";
  const normalized = normalizeModelEvidence({ evidence: [{
    quote: "tested it with the operations team",
    statement: "Tested it with the operations team",
    competency_ids: ["software_practices"],
    strength: "described",
    ownership: "team",
  }] }, source);
  assert.equal(normalized.evidence[0].ownership, "individual");
});

test("AI run provenance stores hashes and counts without raw audio or transcript", () => {
  const run = recordAiRun({task:"voice_transcription",model:"whisper:test",prompt_version:"test-v1",schema_version:"transcript-v1",input_sha256:"a".repeat(64),input_characters:18,proposed_count:1,kept_count:1,dropped_count:0,latency_ms:12,fallback:false});
  const row = db.prepare("SELECT * FROM ai_runs WHERE run_id=?").get(run.run_id);
  assert.equal(row.input_sha256, "a".repeat(64));
  assert.equal("raw_audio" in row, false);
  assert.equal("transcript" in row, false);
  resetAndSeed();
});

test("recruiter first impression is stored separately and excluded from matching", () => {
  const candidateId=bootstrap().candidates[0].candidate_id;
  const before=db.prepare("SELECT job_id,fit_score FROM match_results WHERE candidate_id=? ORDER BY job_id").all(candidateId);
  db.prepare("INSERT OR REPLACE INTO recruiter_impressions VALUES(?,?,?,?,?,?,?,?)").run("imp-test",candidateId,"rec-test",2,"Very positive","Human context only",1,new Date().toISOString());
  const after=db.prepare("SELECT job_id,fit_score FROM match_results WHERE candidate_id=? ORDER BY job_id").all(candidateId);
  assert.deepEqual(after,before);
  assert.equal(db.prepare("SELECT excluded_from_matching FROM recruiter_impressions WHERE impression_id='imp-test'").get().excluded_from_matching,1);
  resetAndSeed();
});

test("every balanced study list has twelve cases and a six-six arm split", () => {
  for (const id of ["list_1", "list_2", "list_3", "list_4"]) {
    const rows = studyList(id);
    assert.equal(rows.length, 12);
    assert.equal(rows.filter(r => r.arm === "A").length, 6);
    assert.equal(rows.filter(r => r.arm === "B").length, 6);
  }
});

test("participant study data contains no outcome key or direct identity field", () => {
  const file = path.resolve("outputs/balanced_synthetic_study/participant_cases.json");
  const payload = JSON.parse(fs.readFileSync(file, "utf8"));
  const text = JSON.stringify(payload).toLowerCase();
  for (const forbidden of ['"reference_decision"','"full_name"','"email"','"phone"','"gpa"','"work_authorization"','"university"']) assert.equal(text.includes(forbidden), false, forbidden);
});

test("the requirements-matched phrase exists only in the Study 2 component", () => {
  const source = fs.readFileSync(path.resolve("app/src/App.tsx"), "utf8");
  assert.equal((source.match(/Requirements matched:/g) || []).length, 1);
  const beforeStudy = source.slice(0, source.indexOf("function Study("));
  assert.equal(beforeStudy.includes("Requirements matched:"), false);
  for (const forbidden of [">GPA<", "test_meta", "candidate rank", "fit percentage"]) assert.equal(source.toLowerCase().includes(forbidden.toLowerCase()), false, forbidden);
});

test("database management deletes candidates and jobs with related records", () => {
  const before = databaseSnapshot();
  const candidateId = before.candidates[0].candidate_id;
  const jobId = before.jobs[0].job_id;
  assert.equal(deleteCandidate(candidateId), true);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM candidate WHERE candidate_id=?").get(candidateId).n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM match_results WHERE candidate_id=?").get(candidateId).n, 0);
  assert.equal(deleteJob(jobId), true);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE job_id=?").get(jobId).n, 0);
  resetAndSeed();
});

test("database management deletes individual résumé rows and clears quantitative fields", () => {
  const skill=db.prepare("SELECT skill_id,candidate_id,skill FROM candidate_skills LIMIT 1").get();
  assert.equal(deleteCandidateProfileRow("skill",skill.skill_id),true);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM candidate_skills WHERE skill_id=?").get(skill.skill_id).n,0);
  assert.equal(getCandidate(skill.candidate_id).profile.skills.some(value=>value.toLowerCase()===skill.skill.toLowerCase()),false);
  const candidateId=bootstrap().candidates[0].candidate_id;
  assert.equal(clearCandidateProfileField(candidateId,"years_experience"),true);
  assert.equal(getCandidate(candidateId).profile.years_experience,null);
  assert.ok(db.prepare("SELECT COUNT(*) AS n FROM audit_event WHERE candidate_id=? AND action IN ('deleted','cleared')").get(candidateId).n>=1);
  resetAndSeed();
});

test("Study 2 is not exposed in the application navigation", () => {
  const source = fs.readFileSync(path.resolve("app/src/App.tsx"), "utf8");
  const nav = source.slice(source.indexOf("const navItems"), source.indexOf("function App"));
  assert.equal(nav.includes("Study 2"), false);
  assert.equal(nav.includes('id: "study"'), false);
});
