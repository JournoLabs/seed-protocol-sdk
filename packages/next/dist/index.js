import e from "node:fs";
import { createRequire as t } from "node:module";
import n from "node:path";
//#region ../bundler-core/dist/index.js
var r = [
	"fs",
	"fs/promises",
	"node:fs",
	"node:fs/promises"
];
function i(e) {
	return e.includes("promises") ? "@zenfs/core/promises" : "@zenfs/core";
}
var a = {
	"Cross-Origin-Opener-Policy": "same-origin",
	"Cross-Origin-Embedder-Policy": "credentialless",
	"Cross-Origin-Resource-Policy": "same-origin"
};
function o(e) {
	if (e === !1) return null;
	let t = typeof e == "object" && e ? e : {};
	return {
		"Cross-Origin-Opener-Policy": t.coop ?? a["Cross-Origin-Opener-Policy"],
		"Cross-Origin-Embedder-Policy": t.coep ?? a["Cross-Origin-Embedder-Policy"],
		"Cross-Origin-Resource-Policy": t.corp ?? a["Cross-Origin-Resource-Policy"]
	};
}
function s(e, t) {
	let n = new Set(Object.keys(t ?? {}).map((e) => e.toLowerCase()));
	return Object.fromEntries(Object.entries(e).filter(([e]) => !n.has(e.toLowerCase())));
}
//#endregion
//#region src/index.ts
function c(e = {}, t = {}) {
	return p(), typeof e == "function" ? async (n, r) => l(await e(n, r), t) : l(e, t);
}
function l(e, t) {
	let n = t.fsModules ?? [...r], a = o(t.isolationHeaders), c = t.headersSource ?? "/:path*", l = {};
	for (let e of n) l[e] = { browser: i(e) };
	let f = u(), p = Object.fromEntries(Object.entries(f).map(([e, t]) => [e, d(t)])), m = e.webpack, h = e.headers;
	return {
		...e,
		turbopack: {
			...e.turbopack,
			resolveAlias: {
				...p,
				...l,
				...e.turbopack?.resolveAlias
			}
		},
		webpack(e, t) {
			let r = m ? m(e, t) : e, a = r.resolve?.alias ?? {}, o = {};
			for (let [e, t] of Object.entries(f)) {
				let n = e.startsWith("#") ? e : `${e}$`;
				!(n in a) && !(e in a) && (o[n] = t);
			}
			if (!t.isServer) for (let e of n) e in a || (o[e] = i(e));
			return r.resolve = {
				...r.resolve,
				alias: {
					...o,
					...a
				}
			}, r;
		},
		...a || h ? { async headers() {
			let e = h ? await h() : [];
			if (!a) return e;
			let t = e.filter((e) => e.source === c).flatMap((e) => e.headers), n = Object.fromEntries(t.map((e) => [e.key, e.value])), r = Object.entries(s(a, n)).map(([e, t]) => ({
				key: e,
				value: t
			}));
			return r.length > 0 ? [{
				source: c,
				headers: r
			}, ...e] : e;
		} } : {}
	};
}
function u() {
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
function d(t) {
	let r = n.relative(e.realpathSync(process.cwd()), t).split(n.sep).join("/");
	return r.startsWith(".") ? r : `./${r}`;
}
var f = !1;
function p() {
	f || process.env.TURBOPACK !== "1" || m() === 15 && (f = !0, console.warn("[@seedprotocol/next] Next.js 15 with Turbopack cannot load SQLite WASM in the browser, so the Seed SDK will fail to initialize. Run `next dev` and `next build` without --turbopack (webpack), or upgrade to Next.js 16."));
}
function m() {
	try {
		let { version: e } = t(n.join(process.cwd(), "package.json"))("next/package.json");
		return Number(e.split(".")[0]);
	} catch {
		return;
	}
}
//#endregion
export { c as withSeed };

//# sourceMappingURL=index.js.map