import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin, type ViteDevServer } from "vite";

const apiDir = fileURLToPath(new URL("./api", import.meta.url));

/**
 * 개발 서버 전용: /api/<경로>를 api/<경로>.ts의 GET·POST 핸들러로 실행한다(Vercel 로그인 없이 로컬 확인).
 * 빌드 결과에는 포함되지 않는다. 장소·경로는 환경 변수가 없으면 모의 공급자를 쓴다.
 */
function devApi(): Plugin {
  return {
    name: "dev-api",
    apply: "serve",
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        const match = /^\/api\/([a-z]+(?:\/[a-z]+)*)$/.exec(url.pathname);
        const method = req.method === "POST" ? "POST" : req.method === "GET" ? "GET" : null;
        if (!match || !method) return next();
        try {
          const mod = (await server.ssrLoadModule(`${apiDir}/${match[1]}.ts`)) as Partial<
            Record<"GET" | "POST", (request: Request) => Response | Promise<Response>>
          >;
          const handler = mod[method];
          if (!handler) return next();
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const response = await handler(
            new Request(url, {
              method,
              headers: {
                // 빈도 제한 키. 브라우저 테스트는 x-forwarded-for로 테스트마다 다른 키를 보낸다.
                "x-real-ip": String(req.headers["x-forwarded-for"] ?? "127.0.0.1").split(",")[0]!.trim(),
                "content-type": req.headers["content-type"] ?? "",
              },
              body: method === "POST" ? Buffer.concat(chunks) : undefined,
            }),
          );
          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (err) {
          // 브라우저가 요청을 끊은 경우(오프라인 전환 등)는 응답할 곳이 없으므로 오류 화면을 띄우지 않는다.
          if (req.destroyed || (err as Error).message === "aborted") return;
          next(err);
        }
      });
    },
  };
}

// 웹 소스는 web/, 빌드 결과는 Vercel outputDirectory(dist/)로 낸다.
export default defineConfig({
  root: fileURLToPath(new URL("./web", import.meta.url)),
  plugins: [react(), tailwindcss(), devApi()],
  build: {
    outDir: fileURLToPath(new URL("./dist", import.meta.url)),
    emptyOutDir: true,
  },
});
