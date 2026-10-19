// 비밀정보 노출 검사(TASK-011). 빌드 결과(dist/)와 이 폴더의 git 이력에서 키·토큰 모양의 문자열을 찾는다.
// 찾은 값은 출력하지 않고 위치(파일·커밋)와 규칙 이름만 알린다.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SECRET_NAMES = ["KAKAO_REST_API_KEY", "JEJU_ITS_API_KEY", "CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_AI_TOKEN"];

const RULES = [
  { name: "카카오 인증 헤더 값", re: /KakaoAK\s+[0-9a-f]{32}/i },
  { name: "Bearer 토큰 값", re: /Bearer\s+[A-Za-z0-9_-]{30,}/ },
  { name: "비밀 변수 대입", re: new RegExp(`(?:${SECRET_NAMES.join("|")})\\s*[=:]\\s*["']?[A-Za-z0-9_-]{16,}`) },
  { name: "32자리 16진 문자열(키 모양)", re: /(?<![0-9a-f])[0-9a-f]{32}(?![0-9a-f])/ },
];

// 이 환경에 실제 키가 있으면 그 값 자체도 찾는다(값은 메모리에서만 비교).
const literals = SECRET_NAMES.map((n) => process.env[n]).filter((v) => typeof v === "string" && v.length >= 8);

function scan(text) {
  const hits = RULES.filter((r) => r.re.test(text)).map((r) => r.name);
  if (literals.some((v) => text.includes(v))) hits.push("환경 변수의 실제 키 값");
  return hits;
}

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const findings = [];

if (!existsSync("dist")) {
  console.error("dist/가 없습니다. 먼저 npm run build를 실행하세요.");
  process.exit(2);
}
const distFiles = walk("dist").filter((f) => /\.(js|css|html|json|map|txt)$/.test(f));
for (const f of distFiles) for (const h of scan(readFileSync(f, "utf8"))) findings.push(`dist: ${f} — ${h}`);

// 커밋마다 추가된 줄만 본다(삭제 줄은 이미 이력에 있던 것).
const log = execFileSync("git", ["log", "-p", "--all", "--no-color", "--format=commit %h", "--", "."], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
let commit = "";
let file = "";
let commits = 0;
for (const line of log.split("\n")) {
  if (line.startsWith("commit ")) {
    commit = line.slice(7);
    commits += 1;
  } else if (line.startsWith("+++ ")) file = line.slice(6);
  else if (line.startsWith("+") && file !== "package-lock.json") {
    for (const h of scan(line)) findings.push(`git: ${commit} ${file} — ${h}`);
  }
}

console.log(`검사: dist 파일 ${distFiles.length}개, git 커밋 ${commits}개, 실제 키 값 비교 ${literals.length}개`);
if (findings.length) {
  console.error(`비밀정보 의심 ${findings.length}건:`);
  for (const f of [...new Set(findings)]) console.error(`- ${f}`);
  process.exit(1);
}
console.log("비밀정보 의심 문자열 없음");
