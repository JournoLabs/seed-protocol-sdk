import e, { createContext as t, useCallback as n, useContext as r, useEffect as i, useLayoutEffect as a, useMemo as o, useRef as s, useState as c } from "react";
import { flushSync as l } from "react-dom";
import { BaseDb as u, BaseFileManager as d, ClientManagerState as f, EAS_SEED_DATA_SYNCED_TO_DB_EVENT as p, Item as m, ItemProperty as h, Model as g, ModelProperty as _, SEED_PROTOCOL_SCHEMA_NAME as v, Schema as y, appState as b, client as x, createNewItem as S, easSyncProcesses as C, eventEmitter as w, getAddressesForItemsFilter as T, getClient as E, getPropertySchema as D, getSchemaNameFromId as ee, getVersionData as te, loadAllSchemasFromDb as ne, metadata as O, modelSchemas as k, models as A, normalizeFeedItemFields as re, properties as j, resolveMediaRef as ie, schemas as M, seeds as N } from "@seedprotocol/sdk";
import { debounce as ae, orderBy as oe, startCase as se } from "lodash-es";
import P from "debug";
import { useSelector as ce } from "@xstate/react";
import { Fragment as F, jsx as I, jsxs as L } from "react/jsx-runtime";
import { and as le, desc as ue, eq as R, gt as de, inArray as fe, isNotNull as pe, isNull as z, like as me, or as B, sql as he } from "drizzle-orm";
import { toSnakeCase as ge } from "drizzle-orm/casing";
import { QueryClient as _e, QueryClientProvider as ve, useQuery as V, useQueryClient as H } from "@tanstack/react-query";
import ye from "pluralize";
//#region src/client.ts
var U = () => ce(E().getService(), (e) => e.value === f.IDLE), W = "addresses.persisted", be = t(0);
function G() {
	return r(be);
}
function xe({ queryClient: e, children: t }) {
	let [r, a] = c(0), o = n(() => {
		e.invalidateQueries({
			queryKey: ["seed", "items"],
			exact: !1
		}), a((e) => e + 1);
	}, [e]);
	return i(() => (w.on(W, o), () => {
		w.off(W, o);
	}), [o]), /* @__PURE__ */ I(be.Provider, {
		value: r,
		children: t
	});
}
//#endregion
//#region src/liveQuery.ts
function K(e) {
	let [t, n] = c(void 0), r = s(null), a = U(), l = o(() => {
		if (!a || !e) return null;
		try {
			return u.liveQuery(e);
		} catch (e) {
			return console.error("[useLiveQuery] Failed to create live query:", e), null;
		}
	}, [e, a]);
	return i(() => {
		if (r.current && (r.current.unsubscribe(), r.current = null), l) return r.current = l.subscribe({
			next: (e) => {
				n(e === void 0 ? void 0 : [...e]);
			},
			error: (e) => {
				console.error("[useLiveQuery] Error:", e);
			}
		}), () => {
			r.current && (r.current.unsubscribe(), r.current = null);
		};
	}, [l]), t;
}
//#endregion
//#region src/item.ts
var q = P("seedSdk:react:item"), Se = ({ modelName: e, seedLocalId: t, seedUid: r }) => {
	let [a, l] = c(), [, u] = c(0), [d, f] = c(!!(t || r)), [h, g] = c(null), _ = s(void 0), v = s(!1), y = U(), b = G(), x = s(e), S = s(t), C = s(r), T = o(() => y ? !!(S.current || C.current) : !1, [
		y,
		t,
		r
	]), E = n(async () => {
		if (!(y && (S.current || C.current))) {
			l(void 0), f(!1), g(null);
			return;
		}
		try {
			g(null);
			let e = await m.find({
				modelName: x.current,
				seedLocalId: S.current,
				seedUid: C.current
			});
			if (!e) {
				q("[useItem] [loadItem] no item found", x.current, S.current), l((e) => {
					if (e) return e.seedLocalId && e.seedLocalId === S.current || e.seedUid && e.seedUid === C.current ? e : void 0;
				}), f(!1), g(null);
				return;
			}
			l(e), f(!1), g(null);
		} catch (e) {
			q("[useItem] Error loading item:", e), l(void 0), f(!1), g(e);
		}
	}, [y]), D = s(E);
	return i(() => {
		D.current = E;
	}, [E]), i(() => {
		x.current = e, S.current = t, C.current = r;
	}, [
		e,
		t,
		r
	]), i(() => {
		let e = () => {
			u((e) => e + 1), D.current();
		};
		return w.on(p, e), () => {
			w.off(p, e);
		};
	}, []), i(() => {
		if (!T) {
			!t && !r && (l(void 0), f(!1), g(null));
			return;
		}
		E();
	}, [
		T,
		E,
		t,
		r,
		b
	]), i(() => {
		if (!a) {
			_.current?.unsubscribe(), _.current = void 0, v.current = !1;
			return;
		}
		return _.current?.unsubscribe(), v.current = !1, _.current = a.getService().subscribe((e) => {
			e && typeof e == "object" && "value" in e && (e.value === "idle" ? (v.current = !0, f(!1), g(null)) : e.value === "error" ? (g(/* @__PURE__ */ Error("Item service error")), f(!1)) : v.current && f(!0));
		}), () => {
			_.current?.unsubscribe(), _.current = void 0;
		};
	}, [a]), {
		item: a,
		isLoading: d,
		error: h
	};
}, Ce = (e, t, n, r, i) => [
	"seed",
	"items",
	e ?? null,
	t ?? !1,
	n ?? !1,
	r ?? null,
	i ?? 0
], we = ({ modelName: e, deleted: t = !1, includeEas: n = !1, addressFilter: r }) => {
	let a = U(), l = G(), d = H();
	i(() => {
		let e = () => {
			d.invalidateQueries({ queryKey: ["seed", "items"] });
		};
		return w.on(p, e), () => {
			w.off(p, e);
		};
	}, [d]);
	let f = s([]), h = s(/* @__PURE__ */ new Set()), g = s(!1), [_, v] = c(null);
	i(() => {
		if (r !== "owned" && r !== "watched") {
			v(null);
			return;
		}
		let e = !1;
		return T(r).then((t) => {
			e || v(t);
		}), () => {
			e = !0;
		};
	}, [r, l]);
	let y = o(() => Ce(e, t, n, r, l), [
		e,
		t,
		n,
		r,
		l
	]);
	i(() => {
		g.current = !1;
	}, [y]);
	let { data: b = [], isLoading: x, error: S } = V({
		queryKey: y,
		queryFn: async () => await m.all(e, t, {
			waitForReady: !0,
			includeEas: n,
			addressFilter: r
		}),
		enabled: a,
		staleTime: 0
	});
	f.current = b;
	let C = a ? u.getAppDb() : null, E = K(o(() => {
		if (!C || (r === "owned" || r === "watched") && _ === null) return null;
		let i = [];
		n || i.push(B(z(N.uid), R(N.uid, ""))), e && i.push(R(N.type, ge(e))), r === "owned" ? _ && _.length > 0 && i.push(B(fe(N.publisher, _), z(N.publisher))) : r === "watched" && (_ && _.length > 0 ? i.push(fe(N.publisher, _)) : i.push(he`1=0`)), t ? i.push(B(pe(N._markedForDeletion), R(N._markedForDeletion, 1))) : (i.push(B(z(N._markedForDeletion), R(N._markedForDeletion, 0))), i.push(B(z(N.revokedAt), R(N.revokedAt, 0))));
		let a = te();
		return C.with(a).select({
			localId: N.localId,
			uid: N.uid,
			type: N.type,
			schemaUid: N.schemaUid,
			createdAt: N.createdAt,
			attestationCreatedAt: N.attestationCreatedAt,
			_markedForDeletion: N._markedForDeletion
		}).from(N).leftJoin(a, R(N.localId, a.seedLocalId)).where(le(de(a.versionsCount, 0), ...i)).groupBy(N.localId);
	}, [
		C,
		a,
		e,
		t,
		n,
		r,
		_
	]));
	return i(() => {
		if (!a || !E) return;
		let e = /* @__PURE__ */ new Set();
		for (let t of E) {
			let n = t.localId || t.uid;
			n && e.add(n);
		}
		let t = /* @__PURE__ */ new Set();
		for (let e of f.current) {
			let n = e.seedLocalId || e.seedUid;
			n && t.add(n);
		}
		if (e.size === 0 && t.size > 0) return;
		if (!g.current && (g.current = !0, e.size > 0 && t.size === 0)) {
			h.current = new Set(e), d.invalidateQueries({ queryKey: y });
			return;
		}
		let n = h.current;
		if (!(n.size === e.size && [...n].every((t) => e.has(t)))) {
			if (t.size === e.size && [...t].every((t) => e.has(t))) {
				h.current = new Set(e);
				return;
			}
			h.current = new Set(e), d.invalidateQueries({ queryKey: y });
		}
	}, [
		a,
		E,
		d,
		y
	]), {
		items: oe(b, [(e) => e.lastVersionPublishedAt || e.attestationCreatedAt || e.createdAt], ["desc"]),
		isLoading: x,
		error: S
	};
}, Te = () => {
	let [e, t] = c(!1), [r, i] = c(null), a = n(() => i(null), []);
	return {
		createItem: n(async (n, r) => {
			if (e) {
				q("[useCreateItem] [createItem] already creating item, skipping");
				return;
			}
			i(null), l(() => t(!0));
			try {
				let { seedLocalId: e } = await S({
					modelName: n,
					...r ?? {}
				});
				return await m.find({
					modelName: n,
					seedLocalId: e
				}) ?? void 0;
			} catch (e) {
				q("[useCreateItem] Error creating item:", e), i(e instanceof Error ? e : Error(String(e)));
				return;
			} finally {
				queueMicrotask(() => t(!1));
			}
		}, [e]),
		isLoading: e,
		error: r,
		resetError: a
	};
}, Ee = () => {
	let [e, t] = c(null), [r, a] = c(!1), [o, l] = c(null), u = s(void 0), d = n(() => l(null), []), f = n((e) => {
		e && (t(e), l(null), e.publish().catch(() => {}));
	}, []);
	return i(() => {
		if (!e) {
			u.current?.unsubscribe(), u.current = void 0, a(!1);
			return;
		}
		u.current?.unsubscribe();
		let t = e.getService();
		u.current = t.subscribe((e) => {
			let t = e?.value, n = e?.context;
			a(t === "publishing");
			let r = n?._publishError;
			l(r ? Error(r.message) : null);
		});
		let n = t.getSnapshot();
		a(n?.value === "publishing");
		let r = n?.context?._publishError;
		return l(r ? Error(r.message) : null), () => {
			u.current?.unsubscribe(), u.current = void 0;
		};
	}, [e]), {
		publishItem: f,
		isLoading: r,
		error: o,
		resetError: d
	};
}, J = P("seedSdk:react:property"), Y = P("seedSdk:react:itemProperties");
function De(e, t) {
	let r = U(), [l, u] = c(void 0), [d, f] = c(!1), [p, m] = c(null), g = s(void 0), [, _] = c(0), v = typeof e == "object" && e ? e : null, y = v?.itemId, b = v?.seedLocalId, x = v?.seedUid, S = v?.propertyName, C = typeof e == "string" ? e : y !== void 0 && y !== "" ? y : void 0, w = S ?? (typeof e == "string" ? t : void 0), T = o(() => {
		let e = C !== void 0 && C !== "" ? C : b, t = C !== void 0 && C !== "" ? void 0 : x;
		return (e != null || t != null) && w != null && w !== "" ? {
			type: "identifiers",
			seedLocalId: e ?? void 0,
			seedUid: t,
			propertyName: w
		} : null;
	}, [
		C,
		w,
		b,
		x
	]);
	o(() => T ? !!((T.seedLocalId || T.seedUid) && T.propertyName) : !1, [T]);
	let E = o(() => !r || !T ? !1 : !!((T.seedLocalId || T.seedUid) && T.propertyName), [r, T]);
	a(() => {
		E && f(!0);
	}, [E]);
	let D = n(async () => {
		if (!r || !T) {
			u(void 0), f(!1), m(null);
			return;
		}
		try {
			f(!0), m(null);
			let e = T.seedLocalId, t = T.seedUid;
			if (!e && !t) {
				u(void 0), f(!1), m(null);
				return;
			}
			let n = await h.find({
				propertyName: T.propertyName,
				seedLocalId: e,
				seedUid: t
			});
			if (!n) {
				J(`[useItemProperty] [updateItemProperty] no property found for Item.${e || t}.${T.propertyName}`), u(void 0), f(!1), m(null);
				return;
			}
			u(n), f(!1), m(null);
		} catch (e) {
			J("[useItemProperty] Error updating item property:", e), u(void 0), f(!1), m(e);
		}
	}, [r, T]);
	return i(() => {
		if (!E) {
			u(void 0), f(!1), m(null);
			return;
		}
		l && T && l.propertyName === T.propertyName && (T.seedLocalId != null && l.seedLocalId === T.seedLocalId || T.seedUid != null && l.seedUid === T.seedUid) || D();
	}, [
		E,
		D,
		l,
		T
	]), i(() => {
		if (!l) {
			g.current?.unsubscribe(), g.current = void 0;
			return;
		}
		g.current?.unsubscribe();
		let e = 0, t = !1, n;
		return g.current = l.getService().subscribe((r) => {
			if (r && typeof r == "object" && "value" in r && r.value === "idle") {
				f(!1), m(null);
				let e = r.context, i = JSON.stringify([e.renderValue, e.propertyValue]);
				(!t || i !== n) && (t = !0, n = i, _((e) => e + 1));
				return;
			}
			t = !1, n = void 0;
			let i = Date.now();
			i - e >= 50 && (e = i, _((e) => e + 1));
		}), () => {
			g.current?.unsubscribe(), g.current = void 0;
		};
	}, [l]), {
		property: l,
		isLoading: d,
		error: p
	};
}
function Oe(e, t = 300) {
	let r = "itemId" in e ? e.itemId : void 0, a = "seedLocalId" in e ? e.seedLocalId : void 0, c = "seedUid" in e ? e.seedUid : void 0, l = e.propertyName, { property: u, isLoading: d, error: f } = De(o(() => r ? {
		seedLocalId: r,
		propertyName: l
	} : {
		seedLocalId: a,
		seedUid: c,
		propertyName: l
	}, [
		r,
		a,
		c,
		l
	])), p = s(""), m = o(() => ae((e) => {
		e.getService().send({
			type: "save",
			newValue: p.current
		});
	}, t), [t]);
	return i(() => () => m.cancel(), [m]), {
		property: u,
		setValue: n((e) => {
			u && (p.current = e, u.getService().send({
				type: "updateContext",
				propertyValue: e,
				renderValue: e
			}), m(u));
		}, [u, m]),
		isLoading: d,
		error: f
	};
}
async function ke(e, t) {
	if (!e && !t) return [];
	let n = u.getAppDb();
	if (!n) return [];
	let r = await h.all({
		seedLocalId: e ?? void 0,
		seedUid: t ?? void 0
	}, { waitForReady: !0 }), i = [...r], a = /* @__PURE__ */ new Set();
	for (let e of r) e.propertyName && a.add(e.propertyName);
	let o;
	if (r.length > 0) {
		let e = r[0];
		o = e.modelName ?? e.modelType, o && typeof o == "string" && (o = se(o));
	}
	if (!o) {
		let r = await n.select({ type: N.type }).from(N).where(t ? R(N.uid, t) : R(N.localId, e)).limit(1);
		r.length > 0 && r[0].type && (o = se(r[0].type));
	}
	let s = [];
	if (o) try {
		let { Model: e } = await import("@seedprotocol/sdk"), t = await e.getByNameAsync(o);
		if (t?.properties) for (let e of t.properties) e.name && s.push(e.name);
	} catch (e) {
		Y(`[useItemProperties] Error getting ModelProperties for ${o}:`, e);
	}
	if (o && s.length > 0) {
		let n = r.length > 0 ? r[0].seedLocalId ?? e : e, c = r.length > 0 ? r[0].seedUid ?? t : t;
		for (let e of s) if (!a.has(e)) try {
			let t = h.create({
				propertyName: e,
				modelName: o,
				seedLocalId: n || void 0,
				seedUid: c || void 0,
				propertyValue: null
			}, { waitForReady: !1 });
			t && i.push(t);
		} catch (t) {
			J(`[useItemProperties] Error creating ItemProperty for missing property ${e}:`, t);
		}
	}
	if (e || t) {
		let a = await n.select({ createdAt: N.createdAt }).from(N).where(t ? R(N.uid, t) : R(N.localId, e)).limit(1);
		if (a.length > 0 && a[0].createdAt) {
			let n = "createdAt";
			if (!i.some((e) => e.propertyName === n) && o) try {
				let s = r.length > 0 ? r[0].seedLocalId ?? e : e, c = r.length > 0 ? r[0].seedUid ?? t : t, l = h.create({
					propertyName: n,
					modelName: o,
					seedLocalId: s || void 0,
					seedUid: c || void 0,
					propertyValue: a[0].createdAt.toString()
				}, { waitForReady: !1 });
				l && i.push(l);
			} catch (e) {
				J("[useItemProperties] Error creating createdAt ItemProperty:", e);
			}
		}
	}
	return i;
}
function Ae(e) {
	let t = U(), n = H(), r = s(void 0), a = o(() => typeof e == "string" ? {
		type: "itemId",
		itemId: e
	} : typeof e == "object" ? {
		type: "identifiers",
		seedLocalId: e.seedLocalId,
		seedUid: e.seedUid
	} : null, [e]), c = o(() => {
		if (a) return a.type === "itemId" ? a.itemId : a.seedLocalId;
	}, [a]), l = o(() => {
		if (!(!a || a.type === "itemId")) return a.seedUid;
	}, [a]), d = c ?? l ?? "", f = o(() => [
		"seed",
		"itemProperties",
		d
	], [d]), { data: p = [], isLoading: m, error: h } = V({
		queryKey: f,
		queryFn: () => ke(c, l),
		enabled: t && !!d
	}), g = K(o(() => {
		if (!t || !c && !l) return Y("[useItemProperties] Query: returning null (not ready or no identifiers)"), null;
		let e = u.getAppDb();
		if (!e) return Y("[useItemProperties] Query: returning null (no db)"), null;
		Y(`[useItemProperties] Query: creating query for seedLocalId=${c}, seedUid=${l}`);
		let n = l ? e.select({
			propertyName: O.propertyName,
			propertyValue: O.propertyValue,
			seedLocalId: O.seedLocalId,
			seedUid: O.seedUid,
			modelType: O.modelType,
			schemaUid: O.schemaUid,
			createdAt: O.createdAt,
			attestationCreatedAt: O.attestationCreatedAt
		}).from(O).where(le(R(O.seedUid, l), pe(O.propertyName))) : c ? e.select({
			propertyName: O.propertyName,
			propertyValue: O.propertyValue,
			seedLocalId: O.seedLocalId,
			seedUid: O.seedUid,
			modelType: O.modelType,
			schemaUid: O.schemaUid,
			createdAt: O.createdAt,
			attestationCreatedAt: O.attestationCreatedAt
		}).from(O).where(le(R(O.seedLocalId, c), pe(O.propertyName))) : null;
		return Y("[useItemProperties] Query: created query object", { queryType: l ? "seedUid" : "seedLocalId" }), n;
	}, [
		t,
		c,
		l
	])), _ = o(() => {
		if (!g || g.length === 0) return [];
		let e = /* @__PURE__ */ new Map();
		for (let t of g) {
			if (!t.propertyName) continue;
			let n = e.get(t.propertyName);
			if (!n) e.set(t.propertyName, t);
			else {
				let r = n.attestationCreatedAt || n.createdAt || 0;
				(t.attestationCreatedAt || t.createdAt || 0) > r && e.set(t.propertyName, t);
			}
		}
		return Array.from(e.values());
	}, [g]);
	return i(() => {
		if (!t || !c && !l || _ === void 0) return;
		let e = JSON.stringify(_.map((e) => ({
			propertyName: e.propertyName,
			propertyValue: e.propertyValue,
			seedLocalId: e.seedLocalId,
			seedUid: e.seedUid
		})).sort((e, t) => (e.propertyName || "").localeCompare(t.propertyName || "")));
		r.current !== e && (r.current = e, _.length > 0 && n.invalidateQueries({ queryKey: f }));
	}, [
		t,
		_,
		p,
		c,
		l,
		n,
		f
	]), i(() => {
		r.current = void 0;
	}, [c, l]), {
		properties: p,
		isLoading: m,
		error: h
	};
}
var je = () => {
	let e = s(void 0), [t, r] = c(!1), [a, o] = c(null), l = n(() => o(null), []), u = n((t) => {
		if (!t.propertyName || !t.seedLocalId && !t.seedUid || !t.modelName) {
			o(/* @__PURE__ */ Error("seedLocalId or seedUid, propertyName, and modelName are required"));
			return;
		}
		o(null), r(!0), e.current?.unsubscribe(), e.current = void 0;
		let n = h.create(t, { waitForReady: !1 });
		if (!n) {
			o(/* @__PURE__ */ Error("Failed to create item property")), r(!1);
			return;
		}
		return e.current = n.getService().subscribe((e) => {
			if (e?.value === "error") {
				let t = e.context?._loadingError?.error ?? /* @__PURE__ */ Error("Failed to create item property");
				o(t instanceof Error ? t : Error(String(t))), r(!1);
			}
			e?.value === "idle" && (o(null), r(!1));
		}), n;
	}, []);
	return i(() => () => {
		e.current?.unsubscribe(), e.current = void 0;
	}, []), {
		create: u,
		isLoading: t,
		error: a,
		resetError: l
	};
}, Me = () => {
	let [e, t] = c(null), [r, a] = c({
		isLoading: !1,
		error: null
	});
	i(() => {
		if (!e) {
			a({
				isLoading: !1,
				error: null
			});
			return;
		}
		let t = e.getService(), n = () => {
			let e = t.getSnapshot().context;
			a({
				isLoading: !!e._destroyInProgress,
				error: e._destroyError ? Error(e._destroyError.message) : null
			});
		};
		n();
		let r = t.subscribe(n);
		return () => r.unsubscribe();
	}, [e]);
	let o = n(async (e) => {
		e && (t(e), await e.destroy());
	}, []), s = n(() => {
		e && e.getService().send({ type: "clearDestroyError" });
	}, [e]);
	return {
		destroy: o,
		isLoading: r.isLoading,
		error: r.error,
		resetError: s
	};
}, Ne = P("seedSdk:react:services"), Pe = [
	"idle",
	"ready",
	"done",
	"success",
	"initialized"
], Fe = (e) => {
	let t = "actor", n = e;
	return e && n.uniqueKey && (t = n.uniqueKey), e && !n.uniqueKey && n.logic && n.logic.config && (t = X(e)), t;
}, Ie = (e) => {
	let t;
	return e && e.getSnapshot() && e.getSnapshot().value && (t = e.getSnapshot().value), Fe(e) === "global" && t && typeof t == "object" && Object.keys(t).length > 0 && Object.keys(t)[0] === "initialized" && (t = "ready"), t && typeof t == "object" && (t = JSON.stringify(t)), t;
}, X = (e) => {
	let t = e;
	if (!e || !t.logic || !t.logic.config || !t._snapshot) return;
	let n = t.logic.config;
	if (!n.id) return;
	let r = n.id;
	n.id.includes("@seedSdk/") && (r = n.id.match(/^.*@seedSdk\/(\w+)[\.\w]*/)[1]);
	let i;
	try {
		i = e.getSnapshot();
	} catch (e) {
		return Ne("Error:", e), r;
	}
	if (i) {
		let e = i.context;
		e && e.dbName && (r = e.dbName), e && e.modelNamePlural && (r = e.modelNamePlural), e && e.modelName && (r = ye(e.modelName.toLowerCase()));
	}
	return r;
}, Le = (e) => {
	let [t, r] = c(0), a = (e) => {
		let t = 0, n = e;
		if (n.logic?.states) {
			let r = [], i = [];
			for (let [e, t] of Object.entries(n.logic.states)) t.tags?.includes("loading") && (r.push(e), i.push(t));
			let a = i.length, o = Ie(e);
			if (o && Pe.includes(o)) return 0;
			o && (t = r.indexOf(o) / a * 100);
		}
		return t;
	}, o = n((t) => {
		e.getSnapshot().context;
		let n = e.getSnapshot().value;
		if (n === "done" || n === "success" || n === "idle" || n === "ready") {
			clearInterval(t);
			return;
		}
		r((e) => e + 1);
	}, [e]), s = n(() => {
		let e = setInterval(() => {
			o(e);
		}, 1e3);
		return e;
	}, [o, e]);
	return i(() => {
		let e = s();
		return () => clearInterval(e);
	}, []), {
		name: Fe(e),
		timeElapsed: t,
		value: Ie(e),
		percentComplete: a(e),
		uniqueKey: X(e)
	};
}, Re = () => {
	let [e, t] = c(!1), { internalStatus: n } = He();
	return i(() => {
		n === "ready" && t(!0);
	}, [n]), i(() => {
		n === "ready" && t(!0);
	}, []), e;
}, ze = () => {
	let [e, t] = c(!1), r = Be(), { services: a, percentComplete: o } = Ve(), s = n(async () => {
		for (let e of a) Ne(`would save to db with snapshot__${X(e)}:`, JSON.stringify(e.getPersistedSnapshot()));
	}, [a]), l = n(async () => {
		let e = u.getAppDb();
		return e ? await e.select().from(b).where(me(b.key, "snapshot__%")) : [];
	}, []);
	i(() => !r || e ? void 0 : ((async () => {
		Ne("persistedSnapshots:", await l()), t(!0);
	})(), () => {
		s();
	}), [r, e]);
}, Be = () => {
	let [e, t] = c(!1), n = Re();
	return i(() => {
		n && (async () => {
			let e = await u.getAppDb().select().from(b).where(me(b.key, "snapshot__%"));
			e && e.length > 0 && t(!0);
		})();
	}, [n]), e;
}, Ve = () => {
	let [e, t] = c([]), [n, r] = c(5);
	return i(() => {
		let e = E().getService(), n = e;
		n.uniqueKey = "clientManager", t([n]);
		let i = e.subscribe((e) => {
			let t = e.value, n = 0;
			t === f.IDLE ? n = 100 : t === f.ADD_MODELS_TO_DB ? n = 90 : t === f.ADD_MODELS_TO_STORE ? n = 80 : t === f.PROCESS_SCHEMA_FILES ? n = 70 : t === f.SAVE_CONFIG ? n = 60 : t === f.DB_INIT ? n = 50 : t === f.FILE_SYSTEM_INIT ? n = 30 : t === f.PLATFORM_CLASSES_INIT && (n = 10), r(n);
		});
		return () => {
			i.unsubscribe();
		};
	}, []), {
		services: e,
		percentComplete: n
	};
}, He = () => {
	let e = E().getService();
	return {
		status: ce(e, (e) => e.value),
		internalStatus: ce(e, (e) => {
			let t = e.value;
			return t === f.DB_INIT || t === f.SAVE_CONFIG || t === f.PROCESS_SCHEMA_FILES || t === f.ADD_MODELS_TO_STORE || t === f.ADD_MODELS_TO_DB || t === f.IDLE ? "ready" : t;
		})
	};
};
//#endregion
//#region src/db.ts
P("seedSdk:react:db");
var Ue = () => {
	let [e, t] = c(!1), r = n(() => {
		e || t(!0);
	}, []);
	return i(() => {
		let e;
		return (async () => {
			let t = E().getService(), n = t.getSnapshot().value;
			if (n === f.DB_INIT || n === f.SAVE_CONFIG || n === f.PROCESS_SCHEMA_FILES || n === f.ADD_MODELS_TO_STORE || n === f.ADD_MODELS_TO_DB || n === f.IDLE) {
				r();
				return;
			}
			e = t.subscribe((t) => {
				let n = t.value;
				(n === f.DB_INIT || n === f.SAVE_CONFIG || n === f.PROCESS_SCHEMA_FILES || n === f.ADD_MODELS_TO_STORE || n === f.ADD_MODELS_TO_DB || n === f.IDLE) && (r(), e?.unsubscribe());
			});
		})(), () => {
			e && e.unsubscribe();
		};
	}, []), { dbsAreReady: e };
}, We = P("seedSdk:react:schema"), Ge = (e) => {
	let [t, r] = c(null), [a, o] = c(!!e), [u, d] = c(null), f = s(null), p = U(), m = n((e) => {
		o(!0), d(null);
		try {
			let t = y.create(e, { waitForReady: !1 });
			r(t);
			let n = t.getService();
			n.getSnapshot().value === "idle" ? (l(() => o(!1)), d(null)) : o(!0), f.current = n.subscribe((e) => {
				e.value === "idle" ? (l(() => o(!1)), d(null)) : o(!0);
			});
		} catch (e) {
			return We("[useSchema] Error creating schema:", e), d(e), r(null), o(!1), null;
		}
	}, []);
	return i(() => {
		if (f.current && (f.current.unsubscribe(), f.current = null), !p) {
			r(null), d(null), o(!1);
			return;
		}
		if (!e) {
			r(null), d(null), o(!1);
			return;
		}
		return m(e), () => {
			f.current && (f.current.unsubscribe(), f.current = null);
		};
	}, [
		e,
		p,
		m
	]), {
		schema: t,
		isLoading: a,
		error: u
	};
}, Ke = ["seed", "schemas"], qe = () => {
	let e = U(), t = H(), n = s(void 0), r = s([]), { data: a = [], isLoading: c, error: l } = V({
		queryKey: Ke,
		queryFn: () => y.all({ waitForReady: !0 }),
		enabled: e
	});
	r.current = a;
	let d = e ? u.getAppDb() : null, f = K(o(() => d ? d.select().from(M).orderBy(M.name, ue(M.version)) : null, [d, e]));
	return i(() => {
		if (typeof BroadcastChannel > "u") return;
		let e = new BroadcastChannel("seed-schemas-invalidate"), n = () => {
			t.invalidateQueries({ queryKey: Ke });
		};
		return e.addEventListener("message", n), () => {
			e.removeEventListener("message", n), e.close();
		};
	}, [t]), i(() => {
		if (!e || !f) return;
		let i = n.current;
		if ((i ? JSON.stringify(i) : "undefined") === (f ? JSON.stringify(f) : "undefined") && i !== void 0) return;
		n.current = f;
		let a = /* @__PURE__ */ new Set();
		for (let e of r.current) {
			let t = e.id || e.schemaFileId;
			if (t) a.add(t);
			else {
				let t = e.metadata?.name, n = e.version;
				t && n !== void 0 && a.add(`${t}:${n}`);
			}
		}
		let o = /* @__PURE__ */ new Set();
		for (let e of f) e.name !== "Seed Protocol" && (e.schemaFileId ? o.add(e.schemaFileId) : e.name != null && e.version !== void 0 && o.add(`${e.name}:${e.version}`));
		let s = a.size === o.size && [...a].every((e) => o.has(e)), c = a.size > 0 && o.size > 0 && [...o].some((e) => !a.has(e));
		!s && c && t.invalidateQueries({ queryKey: Ke });
	}, [
		e,
		f,
		t
	]), {
		schemas: a,
		isLoading: c,
		error: l
	};
}, Je = () => {
	let e = s(null), [t, r] = c(!1), [a, o] = c(null), l = n(() => o(null), []), u = n((t) => {
		o(null), r(!0), e.current?.unsubscribe(), e.current = null;
		let n = y.create(t, { waitForReady: !1 });
		return e.current = n.getService().subscribe((e) => {
			if (e.value === "error") {
				let t = e.context._loadingError?.error;
				o(t instanceof Error ? t : /* @__PURE__ */ Error("Failed to create schema")), r(!1);
			}
			e.value === "idle" && (o(null), r(!1));
		}), n;
	}, []);
	return i(() => () => {
		e.current?.unsubscribe(), e.current = null;
	}, []), {
		createSchema: u,
		isLoading: t,
		error: a,
		resetError: l
	};
}, Ye = () => {
	let [e, t] = c(null), [r, a] = c({
		isLoading: !1,
		error: null
	});
	i(() => {
		if (!e) {
			a({
				isLoading: !1,
				error: null
			});
			return;
		}
		let t = e.getService(), n = () => {
			let e = t.getSnapshot().context;
			a({
				isLoading: !!e._destroyInProgress,
				error: e._destroyError ? Error(e._destroyError.message) : null
			});
		};
		n();
		let r = t.subscribe(n);
		return () => r.unsubscribe();
	}, [e]);
	let o = n(async (e) => {
		e && (t(e), await e.destroy());
	}, []), s = n(() => {
		e && e.getService().send({ type: "clearDestroyError" });
	}, [e]);
	return {
		destroy: o,
		isLoading: r.isLoading,
		error: r.error,
		resetError: s
	};
}, Xe = () => {
	let [e, t] = c(), r = s(/* @__PURE__ */ new Map()), a = U(), o = n(async () => {
		if (a) try {
			let e = await ne(), n = /* @__PURE__ */ new Set();
			for (let t of e) {
				let e = t.schema.metadata?.name;
				e && n.add(e);
			}
			let i = /* @__PURE__ */ new Map();
			for (let e of n) if (r.current.has(e)) {
				let t = r.current.get(e);
				i.set(e, t);
			} else {
				let t = y.create(e, { waitForReady: !1 });
				i.set(e, t);
			}
			for (let [e, t] of r.current.entries()) n.has(e) || t.unload();
			r.current = i, t(Array.from(i.values()));
		} catch (e) {
			We("Error fetching all schema versions from database:", e), t(null);
		}
	}, [a]);
	return i(() => {
		a && o();
	}, [a, o]), i(() => () => {
		r.current.forEach((e) => {
			e.unload();
		}), r.current.clear();
	}, []), e;
}, Ze = () => Ge(v), Qe = (e) => [
	"seed",
	"models",
	e
], $e = /* @__PURE__ */ new Map(), et = (e) => {
	let t = U(), n = H(), r = s([]), a = o(() => Qe(e), [e]), { data: c = [], isLoading: l, error: d } = V({
		queryKey: a,
		queryFn: async () => {
			let t = n.getQueryData(a), r = await g.all(e, { waitForReady: !1 });
			if (Array.isArray(t) && t.length > 0 && Array.isArray(r) && r.length === 0) return [...t];
			if (Array.isArray(r) && r.length === 0) {
				let e = n.getQueryData(a);
				if (Array.isArray(e) && e.length > 0) return [...e];
			}
			return r;
		},
		enabled: t && !!e
	}), f = e && typeof e == "string" ? e : "";
	c.length > 0 && $e.set(f, c);
	let p = r.current.length > 0 ? r.current : $e.get(f), m = e ? c.length > 0 ? c : p?.length ? p : c : c;
	r.current = m, i(() => {
		if (!e || typeof BroadcastChannel > "u") return;
		let t = new BroadcastChannel("seed-models-invalidate"), r = (t) => {
			let { schemaName: r, schemaFileId: i } = t.data || {};
			(e === r || e === i) && (n.invalidateQueries({ queryKey: a }), n.refetchQueries({ queryKey: a }));
		};
		return t.addEventListener("message", r), () => {
			t.removeEventListener("message", r), t.close();
		};
	}, [
		e,
		n,
		a
	]);
	let h = s(null), _ = s(null);
	function v() {
		let t = u.getAppDb();
		return !t || !e ? null : t.select({
			modelFileId: A.schemaFileId,
			modelName: A.name
		}).from(M).innerJoin(k, R(M.id, k.schemaId)).innerJoin(A, R(k.modelId, A.id)).where(B(R(M.schemaFileId, e), R(M.name, e)));
	}
	let y = K(o(() => {
		if (!e || !t) return null;
		let n = {
			schemaId: e,
			ready: t
		}, r = h.current;
		if (r && r.schemaId === n.schemaId && r.ready === n.ready && _.current !== null) return _.current;
		let i = v();
		return i ? (h.current = n, _.current = i, i) : null;
	}, [e, t]));
	return i(() => {
		if (!t || !y || !e) return;
		let i = /* @__PURE__ */ new Set();
		for (let e of r.current) {
			let t = e.id || e.modelFileId;
			t ? i.add(t) : e.modelName && i.add(e.modelName);
		}
		let o = /* @__PURE__ */ new Set();
		for (let e of y) e.modelFileId ? o.add(e.modelFileId) : e.modelName && o.add(e.modelName);
		let s = i.size === o.size && [...i].every((e) => o.has(e)), c = o.size > 0 && [...o].some((e) => !i.has(e));
		!s && c && n.invalidateQueries({ queryKey: a });
	}, [
		t,
		y,
		e,
		n,
		a
	]), {
		models: m,
		isLoading: l,
		error: d
	};
}, tt = (e, t) => {
	let n = U(), [r, a] = c(void 0), [l, u] = c(!1), [d, f] = c(null), p = s(void 0), [, m] = c(0), h = t == null;
	if (o(() => n ? h ? !!e : !!(e && t) : !1, [
		n,
		h,
		e,
		t
	]), i(() => {
		if (!n || !h || !e) {
			a(void 0), u(!1), f(null);
			return;
		}
		(async () => {
			try {
				u(!0), f(null), a(await g.createById(e) || void 0), u(!1), f(null);
			} catch (e) {
				console.error("[useModel] Error looking up model by ID:", e), a(void 0), u(!1), f(e);
			}
		})();
	}, [
		n,
		h,
		e
	]), i(() => {
		if (!h || !r) {
			p.current?.unsubscribe(), p.current = void 0;
			return;
		}
		return p.current?.unsubscribe(), p.current = r.getService().subscribe((e) => {
			m((e) => e + 1);
		}), () => {
			p.current?.unsubscribe(), p.current = void 0;
		};
	}, [h, r]), h) return {
		model: r,
		isLoading: l,
		error: d
	};
	let { models: _, isLoading: v, error: y } = et(e), b = o(() => {
		if (t) return _.find((e) => (e.modelName ?? e.name) === t);
	}, [_, t]);
	return i(() => {
		if (h || !b) {
			p.current?.unsubscribe(), p.current = void 0;
			return;
		}
		return p.current?.unsubscribe(), p.current = b.getService().subscribe((e) => {
			m((e) => e + 1);
		}), () => {
			p.current?.unsubscribe(), p.current = void 0;
		};
	}, [h, b]), {
		model: b,
		isLoading: v,
		error: y
	};
}, nt = () => {
	let e = s(void 0), [t, r] = c(!1), [a, o] = c(null), l = n(() => o(null), []), u = n((t, n, i) => {
		o(null), r(!0), e.current?.unsubscribe(), e.current = void 0;
		let a = g.create(n, t, {
			...i,
			waitForReady: !1
		});
		return e.current = a.getService().subscribe((e) => {
			e.value === "error" && (o(e.context._loadingError?.error ?? /* @__PURE__ */ Error("Failed to create model")), r(!1)), e.value === "idle" && (o(null), r(!1));
		}), a;
	}, []);
	return i(() => () => {
		e.current?.unsubscribe(), e.current = void 0;
	}, []), {
		create: u,
		isLoading: t,
		error: a,
		resetError: l
	};
}, rt = () => {
	let [e, t] = c(null), [r, a] = c({
		isLoading: !1,
		error: null
	});
	i(() => {
		if (!e) {
			a({
				isLoading: !1,
				error: null
			});
			return;
		}
		let t = e.getService(), n = () => {
			let e = t.getSnapshot().context;
			a({
				isLoading: !!e._destroyInProgress,
				error: e._destroyError ? Error(e._destroyError.message) : null
			});
		};
		n();
		let r = t.subscribe(n);
		return () => r.unsubscribe();
	}, [e]);
	let o = n(async (e) => {
		e && (t(e), await e.destroy());
	}, []), s = n(() => {
		e && e.getService().send({ type: "clearDestroyError" });
	}, [e]);
	return {
		destroy: o,
		isLoading: r.isLoading,
		error: r.error,
		resetError: s
	};
};
//#endregion
//#region src/modelProperty.ts
P("seedSdk:browser:react:modelProperty");
var it = (e, t) => {
	let { model: n } = tt(e, t);
	o(() => {
		if (n) try {
			return n.modelName ?? n.name;
		} catch {
			return;
		}
	}, [n]);
	let r = U(), a = H(), c = o(() => {
		if (!n) return null;
		try {
			return n._getSnapshotContext()._dbId;
		} catch {
			return null;
		}
	}, [n]), l = n?.id, d = o(() => [
		"seed",
		"modelProperties",
		l ?? ""
	], [l]), { data: f = [], isLoading: p, error: m } = V({
		queryKey: d,
		queryFn: () => _.all(l, { waitForReady: !0 }),
		enabled: r && !!l
	}), h = r ? u.getAppDb() : null, g = K(o(() => !h || !c ? null : h.select({
		id: j.id,
		name: j.name,
		dataType: j.dataType,
		schemaFileId: j.schemaFileId
	}).from(j).where(R(j.modelId, c)), [
		h,
		r,
		c
	])), v = s([]);
	return v.current = f, i(() => {
		if (!l || f.length > 0 || !a || !d) return;
		let e = [
			400,
			1200,
			2500
		].map((e) => setTimeout(() => {
			a.invalidateQueries({ queryKey: d });
		}, e));
		return () => e.forEach((e) => clearTimeout(e));
	}, [
		l,
		f.length,
		a,
		d
	]), i(() => {
		if (!r || !n?.id || !g || !d) return;
		let e = /* @__PURE__ */ new Set();
		for (let t of v.current) {
			let n = t._getSnapshotContext()?.id;
			n ? e.add(n) : t.name && e.add(t.name);
		}
		let t = /* @__PURE__ */ new Set();
		for (let e of g) e.schemaFileId ? t.add(e.schemaFileId) : e.name && t.add(e.name);
		!(e.size === t.size && (e.size === 0 || [...e].every((e) => t.has(e)))) && (e.size > 0 || t.size > 0) && a.invalidateQueries({ queryKey: d });
	}, [
		r,
		g,
		n?.id,
		a,
		d
	]), {
		modelProperties: f,
		isLoading: p && f.length === 0,
		error: m
	};
}, at = async (e, t) => {
	let n = await g.createById(e);
	if (!n) return;
	let r = n.modelName ?? n.name;
	if (r) return D(r, t);
};
function ot(e, t, r) {
	let a = o(() => r == null ? t == null ? !!e : !!(e && t) : !!(e && t && r), [
		e,
		t,
		r
	]), [u, d] = c(void 0), [f, p] = c(a), [m, h] = c(null), v = s(void 0), y = U(), b = o(() => r == null ? t == null ? {
		type: "propertyFileId",
		propertyFileId: e
	} : {
		type: "modelFileId",
		modelFileId: e,
		propertyName: t
	} : {
		type: "schemaId",
		schemaId: e,
		modelName: t,
		propertyName: r
	}, [
		e,
		t,
		r
	]), x = o(() => y ? b.type === "propertyFileId" ? !!b.propertyFileId : b.type === "modelFileId" ? !!(b.modelFileId && b.propertyName) : !!(b.schemaId && b.modelName && b.propertyName) : !1, [y, b]), S = n(async () => {
		if (!y) {
			d(void 0), p(!1), h(null);
			return;
		}
		let e, t;
		try {
			if (p(!0), h(null), b.type === "propertyFileId") {
				if (!b.propertyFileId) {
					d(void 0), p(!1), h(null);
					return;
				}
				let e = await _.createById(b.propertyFileId);
				e ? (d(e), p(!1), h(null)) : (d(void 0), p(!1), h(null));
				return;
			} else if (b.type === "modelFileId") {
				if (!b.modelFileId || !b.propertyName) {
					d(void 0), p(!1), h(null);
					return;
				}
				e = await at(b.modelFileId, b.propertyName);
				let n = await g.createById(b.modelFileId);
				t = n?.modelName ?? n?.name;
			} else {
				if (!b.schemaId || !b.modelName || !b.propertyName) {
					d(void 0), p(!1), h(null);
					return;
				}
				e = await D(b.modelName, b.propertyName), t = b.modelName;
			}
			if (e && t) {
				let n = _.create({
					...e,
					modelName: t
				}, { waitForReady: !1 }), r = n instanceof Promise ? await n : n;
				l(() => {
					d(r), p(!1), h(null);
				});
			} else d(void 0), p(!1), h(null);
		} catch (e) {
			console.error("[useModelProperty] Error updating model property:", e), d(void 0), p(!1), h(e);
		}
	}, [
		y,
		b.type,
		b.propertyFileId,
		b.modelFileId,
		b.propertyName,
		b.schemaId,
		b.modelName
	]);
	i(() => {
		if (!x) {
			d(void 0), p(!1), h(null);
			return;
		}
		S();
	}, [x, S]);
	let C = b.type === "propertyFileId";
	return i(() => {
		if (!u || !C) return;
		v.current?.unsubscribe();
		let e = ae(S, 100);
		return v.current = u.getService().subscribe(() => {
			e();
		}), () => {
			e.cancel(), v.current?.unsubscribe(), v.current = void 0;
		};
	}, [
		u,
		S,
		C
	]), {
		modelProperty: u,
		isLoading: f,
		error: m
	};
}
var st = () => {
	let e = s(void 0), [t, r] = c(!1), [a, o] = c(null), l = n(() => o(null), []), u = n((t, n, i) => {
		if (o(null), r(!0), e.current?.unsubscribe(), e.current = void 0, !n || !i.name || !i.dataType) {
			let e = /* @__PURE__ */ Error("modelName, property name and dataType are required");
			throw o(e), r(!1), e;
		}
		let a = ee(t) ?? t, s = _.create({
			...i,
			modelName: n
		}, {
			waitForReady: !1,
			schemaName: a
		});
		return e.current = s.getService().subscribe((e) => {
			if (e.value === "error") {
				let t = e.context._loadingError?.error ?? /* @__PURE__ */ Error("Failed to create model property");
				o(t instanceof Error ? t : Error(String(t))), r(!1);
			}
			e.value === "idle" && (o(null), r(!1));
		}), s;
	}, []);
	return i(() => () => {
		e.current?.unsubscribe(), e.current = void 0;
	}, []), {
		create: u,
		isLoading: t,
		error: a,
		resetError: l
	};
}, ct = () => {
	let [e, t] = c(null), [r, a] = c({
		isLoading: !1,
		error: null
	});
	i(() => {
		if (!e) {
			a({
				isLoading: !1,
				error: null
			});
			return;
		}
		let t = e.getService(), n = () => {
			let e = t.getSnapshot().context;
			a({
				isLoading: !!e._destroyInProgress,
				error: e._destroyError ? Error(e._destroyError.message) : null
			});
		};
		n();
		let r = t.subscribe(n);
		return () => r.unsubscribe();
	}, [e]);
	let o = n(async (e) => {
		e && (t(e), await e.destroy());
	}, []), s = n(() => {
		e && e.getService().send({ type: "clearDestroyError" });
	}, [e]);
	return {
		destroy: o,
		isLoading: r.isLoading,
		error: r.error,
		resetError: s
	};
}, lt = () => {
	let [e, t] = c(null), [r, a] = c({
		isLoading: !1,
		error: null
	});
	i(() => {
		if (!e) {
			a({
				isLoading: !1,
				error: null
			});
			return;
		}
		let t = e.getService(), n = () => {
			let e = t.getSnapshot().context;
			a({
				isLoading: !!e._destroyInProgress,
				error: e._destroyError ? Error(e._destroyError.message) : null
			});
		};
		n();
		let r = t.subscribe(n);
		return () => r.unsubscribe();
	}, [e]);
	let o = n(async (e) => {
		e && (t(e), await e.destroy());
	}, []), s = n(() => {
		e && e.getService().send({ type: "clearDestroyError" });
	}, [e]);
	return {
		deleteItem: o,
		isLoading: r.isLoading,
		error: r.error,
		resetError: s
	};
}, ut = ["seed", "imageFiles"];
function dt() {
	let e = U(), t = H(), { data: n = [], isLoading: r, error: a, refetch: o } = V({
		queryKey: ut,
		queryFn: () => d.listImageFiles(),
		enabled: e
	});
	return i(() => {
		let e = (e) => {
			e.includes("/images/") && t.invalidateQueries({ queryKey: ut });
		}, n = () => {
			t.invalidateQueries({ queryKey: ut });
		};
		return w.on("file-saved", e), w.on("fs.downloadAll.success", n), () => {
			w.off("file-saved", e), w.off("fs.downloadAll.success", n);
		};
	}, [t]), {
		imageFiles: n,
		isLoading: r,
		error: a instanceof Error ? a : null,
		refetch: o
	};
}
//#endregion
//#region src/useFiles.ts
var ft = ["seed", "files"];
function pt(e = "files") {
	let t = U(), n = H(), r = o(() => [...ft, e], [e]), { data: a = [], isLoading: s, error: c, refetch: l } = V({
		queryKey: r,
		queryFn: () => d.listFiles(e),
		enabled: t
	});
	return i(() => {
		let t = (t) => {
			t.includes(`/${e}/`) && n.invalidateQueries({ queryKey: r });
		}, i = () => {
			n.invalidateQueries({ queryKey: r });
		};
		return w.on("file-saved", t), w.on("fs.downloadAll.success", i), () => {
			w.off("file-saved", t), w.off("fs.downloadAll.success", i);
		};
	}, [
		n,
		e,
		r
	]), {
		files: a,
		isLoading: s,
		error: c instanceof Error ? c : null,
		refetch: l
	};
}
//#endregion
//#region src/useEasSyncProcesses.ts
function mt() {
	let e = u.getAppDb();
	return o(() => e ? e.select().from(C).orderBy(ue(C.startedAt)) : null, [e]);
}
function ht() {
	let e = K(mt());
	return {
		records: e,
		nonActiveCount: o(() => e === void 0 ? void 0 : e.filter((e) => e.status !== "in_progress").length, [e])
	};
}
function gt() {
	return K(mt());
}
function _t() {
	return ht().nonActiveCount;
}
function vt(e) {
	let t = u.getAppDb(), n = K(o(() => e != null && t ? t.select().from(C).where(R(C.id, e)).limit(1) : null, [t, e])), r = n === void 0;
	return {
		record: n && n.length > 0 ? n[0] : null,
		isLoading: r
	};
}
//#endregion
//#region src/queryClient.ts
var yt = { queries: {
	networkMode: "offlineFirst",
	gcTime: 1e3 * 60 * 60 * 24,
	staleTime: 1e3 * 60
} };
function bt() {
	return { ...yt };
}
function xt(e) {
	let t = bt();
	return e ? {
		queries: {
			...t.queries,
			...e.queries ?? {}
		},
		mutations: {
			...t.mutations ?? {},
			...e.mutations ?? {}
		}
	} : t;
}
function St(e) {
	let t = bt(), { defaultOptions: n, ...r } = e ?? {};
	return new _e({
		...r,
		defaultOptions: n ? xt(n) : t
	});
}
//#endregion
//#region src/SeedProvider.tsx
var Ct = null;
function wt(e) {
	let t = Ct?.(e);
	return typeof window < "u" && window.__SEED_INVALIDATE_ITEM_PROPERTIES__ && window.__SEED_INVALIDATE_ITEM_PROPERTIES__(e), Promise.resolve(t).then(() => {});
}
function Tt({ queryClient: e }) {
	return i(() => {
		let t = (t) => {
			let n = [
				"seed",
				"itemProperties",
				t
			];
			return e.invalidateQueries({ queryKey: n }), e.refetchQueries({ queryKey: n });
		};
		Ct = t, typeof window < "u" && (window.__SEED_INVALIDATE_ITEM_PROPERTIES__ = t);
		let n = (e) => {
			let n = e?.seedLocalId ?? e?.seedUid;
			n && t(n);
		}, r = () => {
			e.invalidateQueries({
				queryKey: ["seed", "items"],
				exact: !1
			});
		};
		return w.on("itemProperty.saved", n), w.on(p, r), () => {
			w.off("itemProperty.saved", n), w.off(p, r), Ct = null, typeof window < "u" && (window.__SEED_INVALIDATE_ITEM_PROPERTIES__ = null);
		};
	}, [e]), null;
}
function Et({ children: e, queryClient: t, queryClientRef: n }) {
	let r = o(() => t ?? St(), [t]);
	if (n && (n.current = r, typeof window < "u")) {
		let e = window;
		e.__TEST_SEED_QUERY_CLIENT__ = r;
		try {
			window.parent && window.parent !== window && (window.parent.__TEST_SEED_QUERY_CLIENT__ = r);
		} catch {}
	}
	return /* @__PURE__ */ I(ve, {
		client: r,
		children: /* @__PURE__ */ L(xe, {
			queryClient: r,
			children: [/* @__PURE__ */ I(Tt, { queryClient: r }), e]
		})
	});
}
//#endregion
//#region src/SeedClientGate.tsx
function Dt() {
	return /* @__PURE__ */ I("div", {
		style: {
			display: "flex",
			alignItems: "center",
			justifyContent: "center",
			height: "100%",
			width: "100%"
		},
		children: "Loading..."
	});
}
function Ot({ initConfig: e, schema: t, loadingComponent: n, wrapperClassName: r, loadingClassName: a, children: o }) {
	let s = U();
	i(() => {
		let n = t ? {
			...e,
			config: {
				...e.config,
				schema: t
			}
		} : e;
		x.init(n);
	}, [e, t]);
	let c = n ?? /* @__PURE__ */ I(Dt, {});
	return /* @__PURE__ */ L("div", {
		className: r,
		style: r ? void 0 : {
			position: "relative",
			display: "flex",
			height: "100vh",
			width: "100vw"
		},
		children: [/* @__PURE__ */ I("div", {
			className: a,
			style: {
				display: s ? "none" : "flex",
				...!a && {
					position: "absolute",
					inset: 0,
					zIndex: 50,
					alignItems: "center",
					justifyContent: "center"
				}
			},
			"aria-hidden": s,
			children: c
		}), /* @__PURE__ */ I("div", {
			style: {
				flex: 1,
				display: s ? "flex" : "none",
				flexDirection: "column"
			},
			children: o
		})]
	});
}
//#endregion
//#region src/useOPFSFiles.ts
async function kt(e, t = "") {
	let n = [];
	try {
		for await (let [r, i] of e.entries()) {
			let e = t ? `${t}/${r}` : r;
			if (i.kind === "file") try {
				let t = await i.getFile();
				n.push({
					name: r,
					path: e,
					size: t.size,
					type: t.type || "application/octet-stream",
					lastModified: t.lastModified
				});
			} catch (t) {
				console.warn(`Failed to read file ${e}:`, t);
			}
			else if (i.kind === "directory") {
				let t = await kt(i, e);
				n.push(...t);
			}
		}
	} catch (e) {
		console.warn(`Failed to scan directory ${t}:`, e);
	}
	return n;
}
function At(e = {}) {
	let { rootPath: t } = e, [r, a] = c([]), [o, s] = c(!0), [l, u] = c(null), d = n(async () => {
		s(!0), u(null);
		try {
			let e = await navigator.storage.getDirectory();
			if (t) {
				let n = t.split("/").filter(Boolean);
				for (let t of n) e = await e.getDirectoryHandle(t);
			}
			a((await kt(e, t || "")).sort((e, t) => e.path.localeCompare(t.path)));
		} catch (e) {
			u("Failed to access OPFS: " + (e instanceof Error ? e.message : String(e))), console.error("OPFS access error:", e);
		} finally {
			s(!1);
		}
	}, [t]);
	return i(() => {
		d();
	}, [d]), {
		files: r,
		isLoading: o,
		error: l,
		refetch: d
	};
}
//#endregion
//#region src/OPFSFilesManager.tsx
var jt = () => /* @__PURE__ */ I("svg", {
	xmlns: "http://www.w3.org/2000/svg",
	fill: "none",
	viewBox: "0 0 24 24",
	strokeWidth: 1.5,
	stroke: "currentColor",
	style: {
		width: 20,
		height: 20
	},
	children: /* @__PURE__ */ I("path", {
		strokeLinecap: "round",
		strokeLinejoin: "round",
		d: "M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
	})
}), Mt = () => /* @__PURE__ */ I("svg", {
	xmlns: "http://www.w3.org/2000/svg",
	fill: "none",
	viewBox: "0 0 24 24",
	strokeWidth: 1.5,
	stroke: "currentColor",
	style: {
		width: 48,
		height: 48
	},
	children: /* @__PURE__ */ I("path", {
		strokeLinecap: "round",
		strokeLinejoin: "round",
		d: "M2.25 12.75V12a2.25 2.25 0 012.25-2.25h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
	})
}), Nt = () => /* @__PURE__ */ I("svg", {
	xmlns: "http://www.w3.org/2000/svg",
	fill: "none",
	viewBox: "0 0 24 24",
	strokeWidth: 1.5,
	stroke: "currentColor",
	style: {
		width: 20,
		height: 20
	},
	children: /* @__PURE__ */ I("path", {
		strokeLinecap: "round",
		strokeLinejoin: "round",
		d: "M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
	})
}), Pt = () => /* @__PURE__ */ I("svg", {
	xmlns: "http://www.w3.org/2000/svg",
	fill: "none",
	viewBox: "0 0 24 24",
	strokeWidth: 1.5,
	stroke: "currentColor",
	style: {
		width: 20,
		height: 20
	},
	children: /* @__PURE__ */ I("path", {
		strokeLinecap: "round",
		strokeLinejoin: "round",
		d: "M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
	})
}), Ft = () => /* @__PURE__ */ L("svg", {
	xmlns: "http://www.w3.org/2000/svg",
	fill: "none",
	viewBox: "0 0 24 24",
	style: {
		width: 32,
		height: 32
	},
	"aria-hidden": !0,
	children: [/* @__PURE__ */ I("circle", {
		style: { opacity: .25 },
		cx: "12",
		cy: "12",
		r: "10",
		stroke: "currentColor",
		strokeWidth: "4"
	}), /* @__PURE__ */ I("path", {
		style: { opacity: .75 },
		fill: "currentColor",
		d: "M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
	})]
});
function It(e) {
	if (e === 0) return "0 Bytes";
	let t = 1024, n = [
		"Bytes",
		"KB",
		"MB",
		"GB"
	], r = Math.floor(Math.log(e) / Math.log(t));
	return Math.round(e / t ** r * 100) / 100 + " " + n[r];
}
function Lt(e) {
	return new Date(e).toLocaleString();
}
async function Rt(e, t) {
	let n = e.path.split("/").filter(Boolean);
	if (n.length === 0) throw Error("Invalid file path");
	let r = t;
	for (let e = 0; e < n.length - 1; e++) r = await r.getDirectoryHandle(n[e]);
	let i = n[n.length - 1];
	return await (await r.getFileHandle(i)).getFile();
}
async function zt(e, t) {
	let n = e.split("/").filter(Boolean);
	if (n.length === 0) throw Error("Invalid file path");
	let r = t;
	for (let e = 0; e < n.length - 1; e++) r = await r.getDirectoryHandle(n[e]);
	let i = n[n.length - 1];
	await r.removeEntry(i);
}
var Bt = {
	light: {
		title: "text-gray-900",
		description: "text-gray-500",
		batchBar: "bg-gray-100 border-gray-200",
		batchText: "text-gray-900",
		clearButton: "text-gray-500 hover:text-gray-900",
		loadingText: "text-gray-500",
		errorBox: "bg-red-50 border-red-200",
		errorTitle: "text-red-800",
		errorText: "text-red-700",
		emptyIcon: "text-gray-400",
		emptyTitle: "text-gray-900",
		emptyText: "text-gray-500",
		tableHeader: "bg-gray-100 text-gray-900",
		tableRow: "bg-white",
		tableBorder: "border-gray-200 divide-gray-200",
		tableCell: "text-gray-900",
		tableCellMuted: "text-gray-500",
		codeBlock: "bg-gray-100 border-gray-200 text-gray-800",
		actionButton: "text-gray-500 hover:text-gray-700",
		deleteButton: "text-gray-500 hover:text-red-600"
	},
	dark: {
		title: "text-white",
		description: "text-gray-400",
		batchBar: "bg-gray-800 border-gray-700",
		batchText: "text-white",
		clearButton: "text-gray-400 hover:text-white",
		loadingText: "text-gray-400",
		errorBox: "bg-red-900/50 border-red-800",
		errorTitle: "text-red-200",
		errorText: "text-red-300",
		emptyIcon: "text-gray-500",
		emptyTitle: "text-white",
		emptyText: "text-gray-400",
		tableHeader: "bg-gray-900 text-white",
		tableRow: "bg-gray-900",
		tableBorder: "border-gray-800 divide-gray-800",
		tableCell: "text-white",
		tableCellMuted: "text-gray-400",
		codeBlock: "bg-gray-800 border-gray-700 text-gray-300",
		actionButton: "text-gray-400 hover:text-indigo-400",
		deleteButton: "text-gray-400 hover:text-red-500"
	}
}, Z = {
	container: { padding: "2rem 0" },
	header: {
		display: "flex",
		flexWrap: "wrap",
		alignItems: "center",
		gap: "1rem",
		marginBottom: "1rem"
	},
	title: {
		fontSize: "1.5rem",
		fontWeight: 600,
		margin: 0
	},
	description: {
		fontSize: "0.875rem",
		margin: "0.5rem 0 0 0"
	},
	button: "rounded-md px-3 py-2 text-sm font-semibold border-0 cursor-pointer bg-indigo-600 text-white hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600",
	buttonDanger: "rounded-md px-3 py-2 text-sm font-semibold border-0 cursor-pointer bg-red-600 text-white hover:bg-red-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600",
	table: "min-w-full divide-y",
	tableHeader: "py-3.5 pl-4 pr-3 text-left text-sm font-semibold sm:pl-6",
	tableCell: "whitespace-nowrap py-4 pl-4 pr-3 text-sm sm:pl-6",
	errorBox: "rounded-md border p-4 mt-4",
	emptyState: "text-center py-12"
};
function Vt({ rootPath: e, filter: t, onBeforeDelete: n, onAfterDelete: r, onDownload: a, title: o = "Files", description: l = "Browse and download all files stored in the Origin Private File System (OPFS).", theme: u = "dark", className: d }) {
	let f = Bt[u], { files: p, isLoading: m, error: h, refetch: g } = At({ rootPath: e }), _ = t ? p.filter(t) : p, [v, y] = c(/* @__PURE__ */ new Set()), b = s(null), x = _.length > 0 && v.size === _.length, S = v.size > 0 && v.size < _.length, C = (e) => {
		y((t) => {
			let n = new Set(t);
			return n.has(e) ? n.delete(e) : n.add(e), n;
		});
	}, w = () => {
		y(v.size === _.length ? /* @__PURE__ */ new Set() : new Set(_.map((e) => e.path)));
	};
	i(() => {
		y(/* @__PURE__ */ new Set());
	}, [_.length]), i(() => {
		b.current && (b.current.indeterminate = S);
	}, [S]);
	let T = async (e, t = !1) => {
		try {
			let t = await Rt(e, await navigator.storage.getDirectory());
			if (a) await a(e, t);
			else {
				let n = URL.createObjectURL(t), r = document.createElement("a");
				r.href = n, r.download = e.name, document.body.appendChild(r), r.click(), document.body.removeChild(r), URL.revokeObjectURL(n);
			}
		} catch (e) {
			let n = "Failed to download file: " + (e instanceof Error ? e.message : String(e));
			throw t || alert(n), e;
		}
	}, E = async (e) => {
		if (!(n && !await n(e)) && confirm(`Are you sure you want to delete "${e.name}"? This action cannot be undone.`)) try {
			let t = await navigator.storage.getDirectory();
			await zt(e.path, t), await g(), await r?.([e.path]);
		} catch (e) {
			alert("Failed to delete file: " + (e instanceof Error ? e.message : String(e)));
		}
	};
	return /* @__PURE__ */ L("div", {
		className: d,
		style: Z.container,
		children: [
			/* @__PURE__ */ I("style", { children: "@keyframes opfs-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}" }),
			/* @__PURE__ */ L("div", {
				style: Z.header,
				children: [/* @__PURE__ */ L("div", {
					style: {
						flex: 1,
						minWidth: 0
					},
					children: [/* @__PURE__ */ I("h1", {
						style: Z.title,
						className: f.title,
						children: o
					}), /* @__PURE__ */ I("p", {
						style: Z.description,
						className: f.description,
						children: l
					})]
				}), /* @__PURE__ */ I("button", {
					type: "button",
					onClick: g,
					className: Z.button,
					children: "Refresh"
				})]
			}),
			v.size > 0 && /* @__PURE__ */ L("div", {
				className: `mt-4 flex items-center justify-between rounded-lg border px-4 py-3 ${f.batchBar}`,
				children: [/* @__PURE__ */ L("span", {
					className: `text-sm font-medium ${f.batchText}`,
					children: [
						v.size,
						" file",
						v.size === 1 ? "" : "s",
						" selected"
					]
				}), /* @__PURE__ */ L("div", {
					className: "flex items-center gap-3",
					children: [
						/* @__PURE__ */ I("button", {
							onClick: async () => {
								if (v.size === 0) return;
								let e = _.filter((e) => v.has(e.path)), t = [];
								for (let n of e) try {
									await T(n, !0), await new Promise((e) => setTimeout(e, 100));
								} catch (e) {
									t.push(`${n.name}: ${e instanceof Error ? e.message : String(e)}`);
								}
								t.length > 0 && alert(`Some downloads failed:\n${t.join("\n")}`);
							},
							className: Z.button,
							children: /* @__PURE__ */ L("span", {
								className: "inline-flex items-center gap-2",
								children: [/* @__PURE__ */ I(jt, {}), " Download All"]
							})
						}),
						/* @__PURE__ */ I("button", {
							onClick: async () => {
								if (v.size === 0) return;
								let e = _.filter((e) => v.has(e.path)), t = e.map((e) => e.name).join(", ");
								if (!confirm(`Are you sure you want to delete ${v.size} file(s)?\n\nFiles: ${t}\n\nThis action cannot be undone.`)) return;
								let i = await navigator.storage.getDirectory(), a = [], o = [];
								for (let t of e) if (!(n && !await n(t))) try {
									await zt(t.path, i), a.push(t.path);
								} catch (e) {
									o.push(`${t.name}: ${e instanceof Error ? e.message : String(e)}`);
								}
								y(/* @__PURE__ */ new Set()), await g(), a.length > 0 && await r?.(a), o.length > 0 && alert(`Some deletions failed:\n${o.join("\n")}`);
							},
							className: Z.buttonDanger,
							children: /* @__PURE__ */ L("span", {
								className: "inline-flex items-center gap-2",
								children: [/* @__PURE__ */ I(Pt, {}), " Delete All"]
							})
						}),
						/* @__PURE__ */ I("button", {
							onClick: () => y(/* @__PURE__ */ new Set()),
							className: `text-sm cursor-pointer bg-transparent border-0 ${f.clearButton}`,
							children: "Clear selection"
						})
					]
				})]
			}),
			/* @__PURE__ */ I("div", {
				className: "mt-8",
				children: m ? /* @__PURE__ */ L("div", {
					className: "flex justify-center items-center py-12 gap-3",
					children: [/* @__PURE__ */ I("span", {
						style: { animation: "opfs-spin 1s linear infinite" },
						children: /* @__PURE__ */ I(Ft, {})
					}), /* @__PURE__ */ I("span", {
						className: f.loadingText,
						children: "Loading files..."
					})]
				}) : h ? /* @__PURE__ */ L("div", {
					className: `${Z.errorBox} ${f.errorBox}`,
					children: [/* @__PURE__ */ I("h3", {
						className: `m-0 text-sm font-medium ${f.errorTitle}`,
						children: "Error"
					}), /* @__PURE__ */ I("div", {
						className: `mt-2 text-sm ${f.errorText}`,
						children: h
					})]
				}) : _.length === 0 ? /* @__PURE__ */ L("div", {
					className: Z.emptyState,
					children: [
						/* @__PURE__ */ I("span", {
							className: f.emptyIcon,
							children: /* @__PURE__ */ I(Mt, {})
						}),
						/* @__PURE__ */ I("h3", {
							className: `mt-2 text-sm font-semibold ${f.emptyTitle}`,
							children: "No files"
						}),
						/* @__PURE__ */ I("p", {
							className: `mt-1 text-sm ${f.emptyText}`,
							children: "No files found in OPFS."
						})
					]
				}) : /* @__PURE__ */ I("div", {
					className: "overflow-x-auto",
					children: /* @__PURE__ */ L("table", {
						className: Z.table,
						children: [/* @__PURE__ */ I("thead", { children: /* @__PURE__ */ L("tr", {
							className: f.tableBorder,
							children: [
								/* @__PURE__ */ I("th", {
									className: `${Z.tableHeader} w-10 ${f.tableHeader}`,
									children: /* @__PURE__ */ I("input", {
										ref: b,
										type: "checkbox",
										checked: x,
										onChange: w,
										"aria-label": "Select all"
									})
								}),
								/* @__PURE__ */ I("th", {
									className: `${Z.tableHeader} ${f.tableHeader}`,
									children: "Name"
								}),
								/* @__PURE__ */ I("th", {
									className: `${Z.tableHeader} ${f.tableHeader}`,
									children: "Path"
								}),
								/* @__PURE__ */ I("th", {
									className: `${Z.tableHeader} ${f.tableHeader}`,
									children: "Size"
								}),
								/* @__PURE__ */ I("th", {
									className: `${Z.tableHeader} ${f.tableHeader}`,
									children: "Type"
								}),
								/* @__PURE__ */ I("th", {
									className: `${Z.tableHeader} ${f.tableHeader}`,
									children: "Modified"
								}),
								/* @__PURE__ */ I("th", {
									className: `${Z.tableHeader} w-24 ${f.tableHeader}`,
									"aria-label": "Actions"
								})
							]
						}) }), /* @__PURE__ */ I("tbody", {
							className: `divide-y ${f.tableBorder}`,
							children: _.map((e) => /* @__PURE__ */ L("tr", {
								className: f.tableRow,
								children: [
									/* @__PURE__ */ I("td", {
										className: `${Z.tableCell} ${f.tableCell}`,
										children: /* @__PURE__ */ I("input", {
											type: "checkbox",
											checked: v.has(e.path),
											onChange: () => C(e.path),
											"aria-label": `Select ${e.name}`
										})
									}),
									/* @__PURE__ */ I("td", {
										className: `${Z.tableCell} ${f.tableCell}`,
										children: /* @__PURE__ */ L("span", {
											className: "flex items-center gap-2",
											children: [/* @__PURE__ */ I(Nt, {}), e.name]
										})
									}),
									/* @__PURE__ */ I("td", {
										className: `${Z.tableCell} ${f.tableCellMuted}`,
										children: /* @__PURE__ */ I("code", {
											className: `text-xs px-2 py-1 rounded border ${f.codeBlock}`,
											children: e.path
										})
									}),
									/* @__PURE__ */ I("td", {
										className: `${Z.tableCell} ${f.tableCellMuted}`,
										children: It(e.size)
									}),
									/* @__PURE__ */ I("td", {
										className: `${Z.tableCell} ${f.tableCellMuted}`,
										children: e.type
									}),
									/* @__PURE__ */ I("td", {
										className: `${Z.tableCell} ${f.tableCellMuted}`,
										children: Lt(e.lastModified)
									}),
									/* @__PURE__ */ I("td", {
										className: Z.tableCell,
										children: /* @__PURE__ */ L("div", {
											className: "flex gap-2 justify-end",
											children: [/* @__PURE__ */ I("button", {
												type: "button",
												onClick: () => T(e),
												title: "Download",
												className: `p-1.5 rounded cursor-pointer bg-transparent border-0 transition-colors ${f.actionButton}`,
												children: /* @__PURE__ */ I(jt, {})
											}), /* @__PURE__ */ I("button", {
												type: "button",
												onClick: () => E(e),
												title: "Delete",
												className: `p-1.5 rounded cursor-pointer bg-transparent border-0 transition-colors ${f.deleteButton}`,
												children: /* @__PURE__ */ I(Pt, {})
											})]
										})
									})
								]
							}, e.path))
						})]
					})
				})
			})
		]
	});
}
//#endregion
//#region src/SeedImage.tsx
var Q = P("seedSdk:react:SeedImage"), $ = /* @__PURE__ */ new Map(), Ht = (e) => {
	let t = e.match(/^(.*[\/\\])?([^\/\\]+?)(\.[^.\/\\]*)?$/);
	return t && t[2] ? t[2] : e;
};
function Ut(e) {
	return e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function Wt(e, t) {
	let n = RegExp(`^${Ut(t)}$`), r = Ht(e);
	return n.test(r);
}
var Gt = e.memo(({ imageProperty: t, width: n, filename: r, ...a }) => {
	let [o, s] = c(), [l, u] = c(), { property: f } = De({
		propertyName: t.propertyName,
		seedLocalId: t.seedLocalId,
		seedUid: t.seedUid
	}), p = t ?? f, m = r ?? p?.refResolvedValue ?? p?.value, h = p?.value, g = typeof h == "string" ? h : m, _ = h != null && (h instanceof File || h instanceof Blob), [v, y] = c(null), b = e.useRef(null);
	i(() => {
		if (_ && (h instanceof File || h instanceof Blob)) return b.current || (b.current = URL.createObjectURL(h), y(b.current)), () => {
			b.current && (URL.revokeObjectURL(b.current), b.current = null), y(null);
		};
		b.current = null, y(null);
	}, [_, h]), i(() => {
		if (!m || h && ((e) => typeof e == "string" && e.startsWith("blob:"))(h) || v) return;
		let e = !1;
		return (async () => {
			try {
				let t = p?.localStoragePath ? p.localStoragePath : `${d.getFilesPath("images")}/${m}`;
				if (await d.pathExists(t)) {
					let n = await d.getContentUrlFromPath(t);
					!e && n && u(n);
				}
			} catch (e) {
				Q("_getOriginalContentUrl error", e);
			}
		})(), () => {
			e = !0;
		};
	}, [
		m,
		h,
		v,
		p?.localStoragePath
	]), i(() => {
		!n || !m || (async () => {
			try {
				let e = await d.getFs(), t = p?.localStoragePath ? p.localStoragePath.split("/").slice(0, -1).join("/") : d.getFilesPath("images"), r = e.readdirSync(t, { withFileTypes: !0 }).filter((e) => e.isDirectory()).map((e) => parseInt(e.name)), i = r.reduce((e, t) => Math.abs(t - n) < Math.abs(e - n) ? t : e, r[0]), a = Ht(m), o = `${a}-${i}`;
				if ($.has(o)) try {
					let e = $.get(o);
					if (e && (await fetch(e)).ok) {
						s(e);
						return;
					}
				} catch (e) {
					Q("error", e), $.delete(o);
				}
				let c = e.readdirSync(`${t}/${i}`, { withFileTypes: !0 }).find((e) => e.name ? Wt(e.name, a) : !1);
				if (!c) return;
				let l = `${t}/${i}/${c?.name}`;
				if (await d.pathExists(l)) {
					let e = await d.getContentUrlFromPath(l);
					e && ($.set(o, e), s(e));
				}
			} catch (e) {
				Q("_getSizedContentUrl error", e);
			}
		})();
	}, [
		p,
		n,
		g,
		m
	]);
	let x = (e) => typeof e == "string" && e.startsWith("blob:");
	return !(o || l || v || g && x(g)) && !m ? null : /* @__PURE__ */ I("img", {
		src: o || l || v || (x(g) ? g : void 0) || "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
		alt: a.alt || t.propertyName || "Image",
		...a
	});
}, (e, t) => e.imageProperty === t.imageProperty && e.width === t.width && e.filename === t.filename);
//#endregion
//#region src/useResolvedMediaRef.ts
function Kt(e) {
	let { value: t, enabled: r = !0, treatAs: a } = e, [o, s] = c(0), [l, u] = c(null), [d, f] = c(null), [p, m] = c("idle");
	i(() => {
		let e = !1;
		return (async () => {
			if (!r || t == null || String(t).trim() === "") {
				e || (u(null), f(null), m("idle"));
				return;
			}
			e || (m("loading"), f(null));
			try {
				let n = await ie(String(t), { treatAs: a });
				if (e) return;
				u(n), n.status === "empty" ? m("empty") : n.status === "ready" ? m("ready") : m("unresolved");
			} catch (t) {
				if (e) return;
				f(t instanceof Error ? t : Error(String(t))), u(null), m("error");
			}
		})(), () => {
			e = !0;
		};
	}, [
		r,
		t,
		a,
		o
	]);
	let h = n(() => {
		s((e) => e + 1);
	}, []);
	return {
		href: l && l.status === "ready" ? l.href : void 0,
		status: p,
		source: l && l.status === "ready" ? l.source : void 0,
		error: d,
		result: l,
		refetch: h
	};
}
//#endregion
//#region src/SeedMediaImage.tsx
function qt({ value: e, enabled: t, treatAs: n, render: r, alt: i, ...a }) {
	let { href: o } = Kt({
		value: e,
		enabled: t,
		treatAs: n
	});
	if (!o) return null;
	let s = {
		...a,
		src: o,
		alt: i ?? ""
	};
	return r ? /* @__PURE__ */ I(F, { children: r(s) }) : /* @__PURE__ */ I("img", { ...s });
}
//#endregion
//#region src/SeedMediaFile.tsx
function Jt(e) {
	try {
		return new URL(e).pathname.split("/").filter(Boolean).pop() || "Open";
	} catch {
		return "Open";
	}
}
function Yt(e) {
	try {
		let t = new URL(e).protocol;
		return t === "http:" || t === "https:";
	} catch {
		return !1;
	}
}
function Xt({ value: e, enabled: t, treatAs: n, download: r, render: i, children: a, target: o, rel: s, ...c }) {
	let { href: l } = Kt({
		value: e,
		enabled: t,
		treatAs: n
	});
	if (!l) return null;
	let u = Yt(l), d = o === void 0 ? u ? "_blank" : void 0 : o, f = {
		...c,
		href: l,
		download: r,
		target: d,
		rel: s ?? (u && d === "_blank" ? "noopener noreferrer" : void 0),
		children: a ?? Jt(l)
	};
	return i ? /* @__PURE__ */ I(F, { children: i(f) }) : /* @__PURE__ */ I("a", { ...f });
}
//#endregion
//#region src/SeedHtml.tsx
function Zt(e) {
	return typeof e == "string" && e.trim().length > 0;
}
function Qt({ html: e, sanitize: t, render: n, ...r }) {
	if (!Zt(e)) return null;
	let i = t(e);
	return n ? /* @__PURE__ */ I(F, { children: n({ html: i }) }) : /* @__PURE__ */ I("div", {
		...r,
		dangerouslySetInnerHTML: { __html: i }
	});
}
//#endregion
//#region src/formatSeedJson.ts
function $t(e, t) {
	return e.length <= t ? e : `${e.slice(0, t)}…`;
}
function en(e) {
	let t = e.trim();
	return t.startsWith("{") && t.endsWith("}") || t.startsWith("[") && t.endsWith("]");
}
function tn(e, t, n, r, i) {
	if (typeof e == "bigint") return String(e);
	if (typeof e == "symbol") return e.toString();
	if (typeof e == "function") return "[Function]";
	if (e instanceof Date) return e.toISOString();
	if (typeof e == "string") return $t(e, n);
	if (typeof e != "object" || !e) return e;
	if (i.has(e)) return "[Circular]";
	if (r >= t) return "[Max depth]";
	if (i.add(e), Array.isArray(e)) return e.map((e) => tn(e, t, n, r + 1, i));
	let a = {};
	for (let [o, s] of Object.entries(e)) a[o] = tn(s, t, n, r + 1, i);
	return a;
}
function nn(e, t) {
	let n = t?.maxDepth ?? 6, r = t?.maxStringLength ?? 5e4, i = t?.space ?? 2;
	if (e === void 0) return "undefined";
	if (e === null) return "null";
	let a = e;
	if (typeof e == "string") if (en(e)) try {
		a = JSON.parse(e);
	} catch {
		return $t(e, r);
	}
	else return $t(e, r);
	let o = tn(a, n, r, 0, /* @__PURE__ */ new WeakSet());
	try {
		return JSON.stringify(o, null, i);
	} catch {
		return "[Unserializable JSON]";
	}
}
//#endregion
//#region src/SeedJson.tsx
function rn({ value: e, format: t, formatOptions: n, render: r, ...i }) {
	let a = t ? t(e) : nn(e, n);
	return r ? /* @__PURE__ */ I(F, { children: r({ text: a }) }) : /* @__PURE__ */ I("pre", {
		...i,
		children: a
	});
}
//#endregion
//#region src/useNormalizedFeedItemFields.ts
function an(e, t) {
	return o(() => e ? re(e, t) : {}, [e, t]);
}
//#endregion
export { W as ADDRESSES_PERSISTED_EVENT, ft as FILES_QUERY_KEY_PREFIX, Vt as OPFSFilesManager, Ot as SeedClientGate, Qt as SeedHtml, Gt as SeedImage, rn as SeedJson, Xt as SeedMediaFile, qt as SeedMediaImage, Et as SeedProvider, St as createSeedQueryClient, nn as formatSeedJson, bt as getSeedQueryDefaultOptions, Fe as getServiceName, X as getServiceUniqueKey, Ie as getServiceValue, wt as invalidateItemPropertiesForItem, xt as mergeSeedQueryDefaults, Xe as useAllSchemaVersions, Te as useCreateItem, je as useCreateItemProperty, nt as useCreateModel, st as useCreateModelProperty, Je as useCreateSchema, Ue as useDbsAreReady, Oe as useDebouncedItemProperty, lt as useDeleteItem, Me as useDestroyItemProperty, rt as useDestroyModel, ct as useDestroyModelProperty, Ye as useDestroySchema, vt as useEasSyncProcessById, gt as useEasSyncProcesses, _t as useEasSyncProcessesNonActiveCount, ht as useEasSyncProcessesState, pt as useFiles, He as useGlobalServiceStatus, Be as useHasSavedSnapshots, dt as useImageFiles, Re as useIsDbReady, Se as useItem, Ae as useItemProperties, De as useItemProperty, we as useItems, K as useLiveQuery, tt as useModel, it as useModelProperties, ot as useModelProperty, et as useModels, an as useNormalizedFeedItemFields, At as useOPFSFiles, ze as usePersistedSnapshots, Ee as usePublishItem, Kt as useResolvedMediaRef, Ge as useSchema, qe as useSchemas, G as useSeedAddressRevision, Ze as useSeedProtocolSchema, Le as useService, Ve as useServices };

//# sourceMappingURL=index.js.map