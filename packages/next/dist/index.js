import e from "node:fs";
import { createRequire as t } from "node:module";
import n from "node:path";
//#region ../bundler-core/dist/index.js
function r(e) {
	return e.includes("promises") ? "@zenfs/core/promises" : "@zenfs/core";
}
var i = {
	"Cross-Origin-Opener-Policy": "same-origin",
	"Cross-Origin-Embedder-Policy": "credentialless",
	"Cross-Origin-Resource-Policy": "same-origin"
};
function a(e) {
	if (e === !1) return null;
	let t = typeof e == "object" && e ? e : {};
	return {
		"Cross-Origin-Opener-Policy": t.coop ?? i["Cross-Origin-Opener-Policy"],
		"Cross-Origin-Embedder-Policy": t.coep ?? i["Cross-Origin-Embedder-Policy"],
		"Cross-Origin-Resource-Policy": t.corp ?? i["Cross-Origin-Resource-Policy"]
	};
}
function o(e, t) {
	let n = new Set(Object.keys(t ?? {}).map((e) => e.toLowerCase()));
	return Object.fromEntries(Object.entries(e).filter(([e]) => !n.has(e.toLowerCase())));
}
//#endregion
//#region src/index.ts
function s(e = {}, t = {}) {
	return f(), typeof e == "function" ? async (n, r) => c(await e(n, r), t) : c(e, t);
}
function c(e, t) {
	let n = t.fsModules ?? [], i = a(t.isolationHeaders), s = t.headersSource ?? "/:path*", c = {};
	for (let e of n) c[e] = { browser: r(e) };
	let d = l(), f = Object.fromEntries(Object.entries(d).map(([e, t]) => [e, u(t)])), p = e.webpack, m = e.headers;
	return {
		...e,
		turbopack: {
			...e.turbopack,
			resolveAlias: {
				...f,
				...c,
				...e.turbopack?.resolveAlias
			}
		},
		webpack(e, t) {
			let i = p ? p(e, t) : e, a = i.resolve?.alias ?? {}, o = {};
			for (let [e, t] of Object.entries(d)) {
				let n = e.startsWith("#") ? e : `${e}$`;
				!(n in a) && !(e in a) && (o[n] = t);
			}
			if (!t.isServer) for (let e of n) e in a || (o[e] = r(e));
			return i.resolve = {
				...i.resolve,
				alias: {
					...o,
					...a
				}
			}, i;
		},
		...i || m ? { async headers() {
			let e = m ? await m() : [];
			if (!i) return e;
			let t = e.filter((e) => e.source === s).flatMap((e) => e.headers), n = Object.fromEntries(t.map((e) => [e.key, e.value])), r = Object.entries(o(i, n)).map(([e, t]) => ({
				key: e,
				value: t
			}));
			return r.length > 0 ? [{
				source: s,
				headers: r
			}, ...e] : e;
		} } : {}
	};
}
function l() {
	let e = {}, r;
	try {
		r = t(n.join(process.cwd(), "package.json")).resolve("@seedprotocol/sdk/package.json");
	} catch {
		return e;
	}
	e["#seed-node-platform"] = n.join(n.dirname(r), "dist", "platform.browser.js");
	try {
		let i = t(r).resolve("@seedprotocol/query/package.json");
		e["@seedprotocol/query"] = n.join(n.dirname(i), "dist", "index.js");
	} catch {}
	return e;
}
function u(t) {
	let r = n.relative(e.realpathSync(process.cwd()), t).split(n.sep).join("/");
	return r.startsWith(".") ? r : `./${r}`;
}
var d = !1;
function f() {
	d || process.env.TURBOPACK !== "1" || p() === 15 && (d = !0, console.warn("[@seedprotocol/next] Next.js 15 with Turbopack cannot load SQLite WASM in the browser, so the Seed SDK will fail to initialize. Run `next dev` and `next build` without --turbopack (webpack), or upgrade to Next.js 16."));
}
function p() {
	try {
		let { version: e } = t(n.join(process.cwd(), "package.json"))("next/package.json");
		return Number(e.split(".")[0]);
	} catch {
		return;
	}
}
//#endregion
export { s as withSeed };

//# sourceMappingURL=index.js.map