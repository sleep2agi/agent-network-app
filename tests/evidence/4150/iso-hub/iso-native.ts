// Synthetic native OpenCode shared-server fixture for the isolated Hub run.
// NOT the real opencode runtime: it answers the same read shape the daemon's
// directory reader consumes, so the client -> Hub -> daemon wire is real while
// the native side is stubbed and labelled as such in the evidence.
const project = "/tmp/opencode/iso-project";
const sessions = new Set<string>(["ses_Existing000000000000000001"]);
let posts = 0;

Bun.serve({
  port: 8911,
  hostname: "127.0.0.1",
  async fetch(req) {
    const u = new URL(req.url);
    if (!req.headers.get("authorization")) return new Response("", { status: 401 });
    if (u.pathname === "/api/info") return Response.json({ version: "2.0.22", data: { id: "osrv_stub", directory: project } });
    if (u.pathname === "/api/provider") return Response.json({ location: { directory: project }, data: [{ id: "stub", activation: "enabled" }] });
    if (u.pathname === "/api/model") return Response.json({ location: { directory: project }, data: [{ id: "model", providerID: "stub" }] });
    if (u.pathname === "/api/project") return Response.json([{ id: "prj_Selected", canonical: project, name: "Existing project", sandboxes: [], time: { created: 1, updated: 2 } }]);
    if (u.pathname === "/api/session/active") return Response.json({ data: {} });
    if (u.pathname === "/api/session" && req.method === "GET")
      return Response.json({ data: [...sessions].map(id => ({ id, projectID: "prj_Selected", location: { directory: project }, title: "Existing" })), cursor: { next: null } });
    if (u.pathname === "/api/session" && req.method === "POST") {
      posts++;
      const id = `ses_New${Date.now().toString(36)}${posts}`;
      sessions.add(id);
      return Response.json({ data: { id, projectID: "prj_Selected", location: { directory: project } } });
    }
    if (u.pathname.startsWith("/api/session/")) {
      const id = u.pathname.slice("/api/session/".length);
      if (!sessions.has(id)) return new Response("", { status: 404 });
      return Response.json({ data: { id, projectID: "prj_Selected", location: { directory: project }, model: { providerID: "stub", id: "model" } } });
    }
    return Response.json({ data: {} });
  },
});
console.log("native fixture on 127.0.0.1:8911");
