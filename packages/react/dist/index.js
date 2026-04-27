import qe, { createContext as rt, useContext as nt, useState as S, useCallback as x, useEffect as w, useRef as C, useMemo as N, useLayoutEffect as st } from "react";
import { flushSync as ue } from "react-dom";
import { getClient as ge, ClientManagerState as P, eventEmitter as z, BaseDb as j, Item as Ce, EAS_SEED_DATA_SYNCED_TO_DB_EVENT as ne, getAddressesForItemsFilter as ot, seeds as D, getVersionData as it, createNewItem as at, ItemProperty as ie, metadata as k, appState as fe, Schema as be, schemas as X, loadAllSchemasFromDb as ct, SEED_PROTOCOL_SCHEMA_NAME as lt, Model as ae, models as ce, modelSchemas as ve, ModelProperty as ye, properties as te, getPropertySchema as ze, getSchemaNameFromId as dt, BaseFileManager as W, easSyncProcesses as pe, client as ut, resolveMediaRef as ft, normalizeFeedItemFields as yt } from "@seedprotocol/sdk";
import { orderBy as pt, debounce as He, startCase as Pe } from "lodash-es";
import G from "debug";
import { useSelector as Le } from "@xstate/react";
import { jsx as g, jsxs as U, Fragment as Se } from "react/jsx-runtime";
import { or as re, isNull as le, eq as q, inArray as Te, sql as mt, isNotNull as Ae, and as xe, gt as ht, like as Qe, desc as Ve } from "drizzle-orm";
import { toSnakeCase as gt } from "drizzle-orm/casing";
import { useQueryClient as Z, useQuery as ee, QueryClient as bt, QueryClientProvider as St } from "@tanstack/react-query";
import vt from "pluralize";
const Q = () => {
  const t = ge().getService();
  return Le(t, (n) => n.value === P.IDLE);
}, Me = "addresses.persisted", Ke = rt(0);
function je() {
  return nt(Ke);
}
function wt({
  queryClient: e,
  children: t
}) {
  const [r, n] = S(0), o = x(() => {
    e.invalidateQueries({ queryKey: ["seed", "items"], exact: !1 }), n((a) => a + 1);
  }, [e]);
  return w(() => (z.on(Me, o), () => {
    z.off(Me, o);
  }), [o]), /* @__PURE__ */ g(Ke.Provider, { value: r, children: t });
}
function Y(e) {
  const [t, r] = S(void 0), n = C(null), o = Q(), a = N(() => {
    if (!o || !e)
      return null;
    try {
      return j.liveQuery(e);
    } catch (s) {
      return console.error("[useLiveQuery] Failed to create live query:", s), null;
    }
  }, [e, o]);
  return w(() => {
    if (n.current && (n.current.unsubscribe(), n.current = null), !a)
      return;
    const s = a.subscribe({
      next: (c) => {
        r(c !== void 0 ? [...c] : void 0);
      },
      error: (c) => {
        console.error("[useLiveQuery] Error:", c);
      }
    });
    return n.current = s, () => {
      n.current && (n.current.unsubscribe(), n.current = null);
    };
  }, [a]), t;
}
const me = G("seedSdk:react:item"), pr = ({ modelName: e, seedLocalId: t, seedUid: r }) => {
  const [n, o] = S(), [, a] = S(0), [s, c] = S(!!(t || r)), [l, i] = S(null), d = C(void 0), u = C(!1), f = Q(), b = je(), v = C(e), h = C(t), y = C(r), p = N(() => f ? !!(h.current || y.current) : !1, [f, t, r]), E = x(async () => {
    if (!!!(f && (h.current || y.current))) {
      o(void 0), c(!1), i(null);
      return;
    }
    try {
      i(null);
      const _ = await Ce.find({
        modelName: v.current,
        seedLocalId: h.current,
        seedUid: y.current
      });
      if (!_) {
        me("[useItem] [loadItem] no item found", v.current, h.current), o((R) => R && (R.seedLocalId && R.seedLocalId === h.current || R.seedUid && R.seedUid === y.current) ? R : void 0), c(!1), i(null);
        return;
      }
      o(_), c(!1), i(null);
    } catch (_) {
      me("[useItem] Error loading item:", _), o(void 0), c(!1), i(_);
    }
  }, [f]), I = C(E);
  return w(() => {
    I.current = E;
  }, [E]), w(() => {
    v.current = e, h.current = t, y.current = r;
  }, [e, t, r]), w(() => {
    const m = () => {
      a((_) => _ + 1), I.current();
    };
    return z.on(ne, m), () => {
      z.off(ne, m);
    };
  }, []), w(() => {
    if (!p) {
      !t && !r && (o(void 0), c(!1), i(null));
      return;
    }
    E();
  }, [p, E, t, r, b]), w(() => {
    if (!n) {
      d.current?.unsubscribe(), d.current = void 0, u.current = !1;
      return;
    }
    d.current?.unsubscribe(), u.current = !1;
    const _ = n.getService().subscribe((R) => {
      R && typeof R == "object" && "value" in R && (R.value === "idle" ? (u.current = !0, c(!1), i(null)) : R.value === "error" ? (i(new Error("Item service error")), c(!1)) : u.current && c(!0));
    });
    return d.current = _, () => {
      d.current?.unsubscribe(), d.current = void 0;
    };
  }, [n]), {
    item: n,
    isLoading: s,
    error: l
  };
}, It = (e, t, r, n, o) => [
  "seed",
  "items",
  e ?? null,
  t ?? !1,
  r ?? !1,
  n ?? null,
  o ?? 0
], mr = ({
  modelName: e,
  deleted: t = !1,
  includeEas: r = !1,
  addressFilter: n
}) => {
  const o = Q(), a = je(), s = Z();
  w(() => {
    const I = () => {
      s.invalidateQueries({ queryKey: ["seed", "items"] });
    };
    return z.on(ne, I), () => {
      z.off(ne, I);
    };
  }, [s]);
  const c = C([]), l = C(/* @__PURE__ */ new Set()), i = C(!1), [d, u] = S(null);
  w(() => {
    if (n !== "owned" && n !== "watched") {
      u(null);
      return;
    }
    let I = !1;
    return ot(n).then((m) => {
      I || u(m);
    }), () => {
      I = !0;
    };
  }, [n, a]);
  const f = N(
    () => It(e, t, r, n, a),
    [e, t, r, n, a]
  );
  w(() => {
    i.current = !1;
  }, [f]);
  const {
    data: b = [],
    isLoading: v,
    error: h
  } = ee({
    queryKey: f,
    queryFn: async () => await Ce.all(e, t, {
      waitForReady: !0,
      includeEas: r,
      addressFilter: n
    }),
    enabled: o,
    // Local SQLite + live invalidation drive freshness; Seed’s default staleTime would keep a
    // mistaken initial [] “fresh” and block refetch when another subscriber mounts.
    staleTime: 0
  });
  c.current = b;
  const y = o ? j.getAppDb() : null, p = N(() => {
    if (!y || (n === "owned" || n === "watched") && d === null)
      return null;
    const I = [];
    r || I.push(re(le(D.uid), q(D.uid, ""))), e && I.push(q(D.type, gt(e))), n === "owned" ? d && d.length > 0 && I.push(
      re(
        Te(D.publisher, d),
        le(D.publisher)
      )
    ) : n === "watched" && (d && d.length > 0 ? I.push(Te(D.publisher, d)) : I.push(mt`1=0`)), t ? I.push(
      re(
        Ae(D._markedForDeletion),
        q(D._markedForDeletion, 1)
      )
    ) : (I.push(
      re(
        le(D._markedForDeletion),
        q(D._markedForDeletion, 0)
      )
    ), I.push(
      re(le(D.revokedAt), q(D.revokedAt, 0))
    ));
    const m = it();
    return y.with(m).select({
      localId: D.localId,
      uid: D.uid,
      type: D.type,
      schemaUid: D.schemaUid,
      createdAt: D.createdAt,
      attestationCreatedAt: D.attestationCreatedAt,
      _markedForDeletion: D._markedForDeletion
    }).from(D).leftJoin(m, q(D.localId, m.seedLocalId)).where(xe(ht(m.versionsCount, 0), ...I)).groupBy(D.localId);
  }, [y, o, e, t, r, n, d]), E = Y(p);
  return w(() => {
    if (!o || !E) return;
    const I = /* @__PURE__ */ new Set();
    for (const A of E) {
      const B = A.localId || A.uid;
      B && I.add(B);
    }
    const m = /* @__PURE__ */ new Set();
    for (const A of c.current) {
      const B = A.seedLocalId || A.seedUid;
      B && m.add(B);
    }
    if (I.size === 0 && m.size > 0)
      return;
    if (!i.current && (i.current = !0, I.size > 0 && m.size === 0)) {
      l.current = new Set(I), s.invalidateQueries({ queryKey: f });
      return;
    }
    const _ = l.current;
    if (_.size === I.size && [..._].every((A) => I.has(A)))
      return;
    if (m.size === I.size && [...m].every((A) => I.has(A))) {
      l.current = new Set(I);
      return;
    }
    l.current = new Set(I), s.invalidateQueries({ queryKey: f });
  }, [o, E, s, f]), {
    items: pt(
      b,
      [
        (I) => I.lastVersionPublishedAt || I.attestationCreatedAt || I.createdAt
      ],
      ["desc"]
    ),
    isLoading: v,
    error: h
  };
}, hr = () => {
  const [e, t] = S(!1), [r, n] = S(null), o = x(() => n(null), []);
  return {
    createItem: x(
      async (s, c) => {
        if (e) {
          me("[useCreateItem] [createItem] already creating item, skipping");
          return;
        }
        n(null), ue(() => t(!0));
        try {
          const l = c ?? {}, { seedLocalId: i } = await at({ modelName: s, ...l });
          return await Ce.find({ modelName: s, seedLocalId: i }) ?? void 0;
        } catch (l) {
          me("[useCreateItem] Error creating item:", l), n(l instanceof Error ? l : new Error(String(l)));
          return;
        } finally {
          queueMicrotask(() => t(!1));
        }
      },
      [e]
    ),
    isLoading: e,
    error: r,
    resetError: o
  };
}, gr = () => {
  const [e, t] = S(null), [r, n] = S(!1), [o, a] = S(null), s = C(void 0), c = x(() => a(null), []), l = x((i) => {
    i && (t(i), a(null), i.publish().catch(() => {
    }));
  }, []);
  return w(() => {
    if (!e) {
      s.current?.unsubscribe(), s.current = void 0, n(!1);
      return;
    }
    s.current?.unsubscribe();
    const i = e.getService(), d = i.subscribe((v) => {
      const h = v?.value, y = v?.context;
      n(h === "publishing");
      const p = y?._publishError;
      a(p ? new Error(p.message) : null);
    });
    s.current = d;
    const u = i.getSnapshot();
    n(u?.value === "publishing");
    const b = u?.context?._publishError;
    return a(b ? new Error(b.message) : null), () => {
      s.current?.unsubscribe(), s.current = void 0;
    };
  }, [e]), {
    publishItem: l,
    isLoading: r,
    error: o,
    resetError: c
  };
}, he = G("seedSdk:react:property"), oe = G("seedSdk:react:itemProperties");
function We(e, t) {
  const r = Q(), [n, o] = S(void 0), [a, s] = S(!1), [c, l] = S(null), i = C(void 0), [, d] = S(0), f = typeof e == "object" && e != null ? e : null, b = f?.itemId, v = f?.seedLocalId, h = f?.seedUid, y = f?.propertyName, p = typeof e == "string" ? e : b !== void 0 && b !== "" ? b : void 0, I = y ?? (typeof e == "string" ? t : void 0), m = N(() => {
    const A = p !== void 0 && p !== "" ? p : v, B = p !== void 0 && p !== "" ? void 0 : h;
    return (A != null || B != null) && I != null && I !== "" ? {
      type: "identifiers",
      seedLocalId: A ?? void 0,
      seedUid: B,
      propertyName: I
    } : null;
  }, [p, I, v, h]);
  N(() => m ? !!((m.seedLocalId || m.seedUid) && m.propertyName) : !1, [m]);
  const _ = N(() => !r || !m ? !1 : !!((m.seedLocalId || m.seedUid) && m.propertyName), [r, m]);
  st(() => {
    _ && s(!0);
  }, [_]);
  const R = x(async () => {
    if (!r || !m) {
      o(void 0), s(!1), l(null);
      return;
    }
    try {
      s(!0), l(null);
      const A = m.seedLocalId, B = m.seedUid;
      if (!A && !B) {
        o(void 0), s(!1), l(null);
        return;
      }
      const V = await ie.find({
        propertyName: m.propertyName,
        seedLocalId: A,
        seedUid: B
      });
      if (!V) {
        he(
          `[useItemProperty] [updateItemProperty] no property found for Item.${A || B}.${m.propertyName}`
        ), o(void 0), s(!1), l(null);
        return;
      }
      o(V), s(!1), l(null);
    } catch (A) {
      he("[useItemProperty] Error updating item property:", A), o(void 0), s(!1), l(A);
    }
  }, [r, m]);
  return w(() => {
    if (!_) {
      o(void 0), s(!1), l(null);
      return;
    }
    n && m && n.propertyName === m.propertyName && (m.seedLocalId != null && n.seedLocalId === m.seedLocalId || m.seedUid != null && n.seedUid === m.seedUid) || R();
  }, [_, R, n, m]), w(() => {
    if (!n) {
      i.current?.unsubscribe(), i.current = void 0;
      return;
    }
    i.current?.unsubscribe();
    let A = 0, B = !1, V;
    const L = 50, $ = n.getService().subscribe((F) => {
      if (F && typeof F == "object" && "value" in F && F.value === "idle") {
        s(!1), l(null);
        const M = F.context, J = JSON.stringify([M.renderValue, M.propertyValue]);
        (!B || J !== V) && (B = !0, V = J, d((se) => se + 1));
        return;
      }
      B = !1, V = void 0;
      const K = Date.now();
      K - A >= L && (A = K, d((M) => M + 1));
    });
    return i.current = $, () => {
      i.current?.unsubscribe(), i.current = void 0;
    };
  }, [n]), {
    property: n,
    isLoading: a,
    error: c
  };
}
function br(e, t = 300) {
  const r = "itemId" in e ? e.itemId : void 0, n = "seedLocalId" in e ? e.seedLocalId : void 0, o = "seedUid" in e ? e.seedUid : void 0, a = e.propertyName, s = N(() => r ? { seedLocalId: r, propertyName: a } : { seedLocalId: n, seedUid: o, propertyName: a }, [r, n, o, a]), { property: c, isLoading: l, error: i } = We(s), d = C(""), u = N(
    () => He((b) => {
      b.getService().send({
        type: "save",
        newValue: d.current
      });
    }, t),
    [t]
  );
  w(() => () => u.cancel(), [u]);
  const f = x(
    (b) => {
      c && (d.current = b, c.getService().send({
        type: "updateContext",
        propertyValue: b,
        renderValue: b
      }), u(c));
    },
    [c, u]
  );
  return {
    property: c,
    setValue: f,
    isLoading: l,
    error: i
  };
}
async function Et(e, t) {
  if (!e && !t) return [];
  const r = j.getAppDb();
  if (!r) return [];
  const n = await ie.all(
    { seedLocalId: e ?? void 0, seedUid: t ?? void 0 },
    { waitForReady: !0 }
  ), o = [...n], a = /* @__PURE__ */ new Set();
  for (const l of n)
    l.propertyName && a.add(l.propertyName);
  let s;
  if (n.length > 0) {
    const l = n[0];
    s = l.modelName ?? l.modelType, s && typeof s == "string" && (s = Pe(s));
  }
  if (!s) {
    const l = await r.select({ type: D.type }).from(D).where(t ? q(D.uid, t) : q(D.localId, e)).limit(1);
    l.length > 0 && l[0].type && (s = Pe(l[0].type));
  }
  const c = [];
  if (s)
    try {
      const { Model: l } = await import("@seedprotocol/sdk"), i = await l.getByNameAsync(s);
      if (i?.properties)
        for (const d of i.properties)
          d.name && c.push(d.name);
    } catch (l) {
      oe(`[useItemProperties] Error getting ModelProperties for ${s}:`, l);
    }
  if (s && c.length > 0) {
    const l = n.length > 0 ? n[0].seedLocalId ?? e : e, i = n.length > 0 ? n[0].seedUid ?? t : t;
    for (const d of c)
      if (!a.has(d))
        try {
          const u = ie.create(
            {
              propertyName: d,
              modelName: s,
              seedLocalId: l || void 0,
              seedUid: i || void 0,
              propertyValue: null
            },
            { waitForReady: !1 }
          );
          u && o.push(u);
        } catch (u) {
          he(`[useItemProperties] Error creating ItemProperty for missing property ${d}:`, u);
        }
  }
  if (e || t) {
    const l = await r.select({ createdAt: D.createdAt }).from(D).where(t ? q(D.uid, t) : q(D.localId, e)).limit(1);
    if (l.length > 0 && l[0].createdAt) {
      const i = "createdAt";
      if (!o.some((u) => u.propertyName === i) && s)
        try {
          const u = n.length > 0 ? n[0].seedLocalId ?? e : e, f = n.length > 0 ? n[0].seedUid ?? t : t, b = ie.create(
            {
              propertyName: i,
              modelName: s,
              seedLocalId: u || void 0,
              seedUid: f || void 0,
              propertyValue: l[0].createdAt.toString()
            },
            { waitForReady: !1 }
          );
          b && o.push(b);
        } catch (u) {
          he("[useItemProperties] Error creating createdAt ItemProperty:", u);
        }
    }
  }
  return o;
}
function Sr(e) {
  const t = Q(), r = Z(), n = C(void 0), o = N(() => typeof e == "string" ? { type: "itemId", itemId: e } : typeof e == "object" ? {
    type: "identifiers",
    seedLocalId: e.seedLocalId,
    seedUid: e.seedUid
  } : null, [e]), a = N(() => {
    if (o)
      return o.type === "itemId" ? o.itemId : o.seedLocalId;
  }, [o]), s = N(() => {
    if (!(!o || o.type === "itemId"))
      return o.seedUid;
  }, [o]), c = a ?? s ?? "", l = N(
    () => ["seed", "itemProperties", c],
    [c]
  ), {
    data: i = [],
    isLoading: d,
    error: u
  } = ee({
    queryKey: l,
    queryFn: () => Et(a, s),
    enabled: t && !!c
  }), f = N(() => {
    if (!t || !a && !s)
      return oe("[useItemProperties] Query: returning null (not ready or no identifiers)"), null;
    const h = j.getAppDb();
    if (!h)
      return oe("[useItemProperties] Query: returning null (no db)"), null;
    oe(`[useItemProperties] Query: creating query for seedLocalId=${a}, seedUid=${s}`);
    const y = s ? h.select({
      propertyName: k.propertyName,
      propertyValue: k.propertyValue,
      seedLocalId: k.seedLocalId,
      seedUid: k.seedUid,
      modelType: k.modelType,
      schemaUid: k.schemaUid,
      createdAt: k.createdAt,
      attestationCreatedAt: k.attestationCreatedAt
    }).from(k).where(
      xe(
        q(k.seedUid, s),
        Ae(k.propertyName)
      )
    ) : a ? h.select({
      propertyName: k.propertyName,
      propertyValue: k.propertyValue,
      seedLocalId: k.seedLocalId,
      seedUid: k.seedUid,
      modelType: k.modelType,
      schemaUid: k.schemaUid,
      createdAt: k.createdAt,
      attestationCreatedAt: k.attestationCreatedAt
    }).from(k).where(
      xe(
        q(k.seedLocalId, a),
        Ae(k.propertyName)
      )
    ) : null;
    return oe("[useItemProperties] Query: created query object", { queryType: s ? "seedUid" : "seedLocalId" }), y;
  }, [t, a, s]), b = Y(f), v = N(() => {
    if (!b || b.length === 0)
      return [];
    const h = /* @__PURE__ */ new Map();
    for (const y of b) {
      if (!y.propertyName) continue;
      const p = h.get(y.propertyName);
      if (!p)
        h.set(y.propertyName, y);
      else {
        const E = p.attestationCreatedAt || p.createdAt || 0;
        (y.attestationCreatedAt || y.createdAt || 0) > E && h.set(y.propertyName, y);
      }
    }
    return Array.from(h.values());
  }, [b]);
  return w(() => {
    if (!t || !a && !s || v === void 0) return;
    const h = JSON.stringify(
      v.map((y) => ({
        propertyName: y.propertyName,
        propertyValue: y.propertyValue,
        seedLocalId: y.seedLocalId,
        seedUid: y.seedUid
      })).sort((y, p) => (y.propertyName || "").localeCompare(p.propertyName || ""))
    );
    n.current !== h && (n.current = h, v.length > 0 && r.invalidateQueries({ queryKey: l }));
  }, [t, v, i, a, s, r, l]), w(() => {
    n.current = void 0;
  }, [a, s]), {
    properties: i,
    isLoading: d,
    error: u
  };
}
const vr = () => {
  const e = C(void 0), [t, r] = S(!1), [n, o] = S(null), a = x(() => o(null), []), s = x((c) => {
    if (!c.propertyName || !c.seedLocalId && !c.seedUid || !c.modelName) {
      const d = new Error("seedLocalId or seedUid, propertyName, and modelName are required");
      o(d);
      return;
    }
    o(null), r(!0), e.current?.unsubscribe(), e.current = void 0;
    const l = ie.create(c, { waitForReady: !1 });
    if (!l) {
      o(new Error("Failed to create item property")), r(!1);
      return;
    }
    const i = l.getService().subscribe((d) => {
      if (d?.value === "error") {
        const u = d.context?._loadingError?.error ?? new Error("Failed to create item property");
        o(u instanceof Error ? u : new Error(String(u))), r(!1);
      }
      d?.value === "idle" && (o(null), r(!1));
    });
    return e.current = i, l;
  }, []);
  return w(() => () => {
    e.current?.unsubscribe(), e.current = void 0;
  }, []), {
    create: s,
    isLoading: t,
    error: n,
    resetError: a
  };
}, wr = () => {
  const [e, t] = S(null), [r, n] = S({
    isLoading: !1,
    error: null
  });
  w(() => {
    if (!e) {
      n({ isLoading: !1, error: null });
      return;
    }
    const s = e.getService(), c = () => {
      const d = s.getSnapshot().context;
      n({
        isLoading: !!d._destroyInProgress,
        error: d._destroyError ? new Error(d._destroyError.message) : null
      });
    };
    c();
    const l = s.subscribe(c);
    return () => l.unsubscribe();
  }, [e]);
  const o = x(async (s) => {
    s && (t(s), await s.destroy());
  }, []), a = x(() => {
    e && e.getService().send({ type: "clearDestroyError" });
  }, [e]);
  return {
    destroy: o,
    isLoading: r.isLoading,
    error: r.error,
    resetError: a
  };
}, Ne = G("seedSdk:react:services"), Lt = ["idle", "ready", "done", "success", "initialized"], Je = (e) => {
  let t = "actor";
  const r = e;
  return e && r.uniqueKey && (t = r.uniqueKey), e && !r.uniqueKey && r.logic && r.logic.config && (t = Re(e)), t;
}, ke = (e) => {
  let t;
  return e && e.getSnapshot() && e.getSnapshot().value && (t = e.getSnapshot().value), Je(e) === "global" && t && typeof t == "object" && Object.keys(t).length > 0 && Object.keys(t)[0] === "initialized" && (t = "ready"), t && typeof t == "object" && (t = JSON.stringify(t)), t;
}, Re = (e) => {
  const t = e;
  if (!e || !t.logic || !t.logic.config || !t._snapshot)
    return;
  const r = t.logic.config;
  if (!r.id)
    return;
  let n = r.id;
  r.id.includes("@seedSdk/") && (n = r.id.match(/^.*@seedSdk\/(\w+)[\.\w]*/)[1]);
  let o;
  try {
    o = e.getSnapshot();
  } catch (a) {
    return Ne("Error:", a), n;
  }
  if (o) {
    const a = o.context;
    a && a.dbName && (n = a.dbName), a && a.modelNamePlural && (n = a.modelNamePlural), a && a.modelName && (n = vt(a.modelName.toLowerCase()));
  }
  return n;
}, Ir = (e) => {
  const [t, r] = S(0), n = (s) => {
    let c = 0;
    const l = s;
    if (l.logic?.states) {
      const i = [], d = [];
      for (const [b, v] of Object.entries(l.logic.states))
        v.tags?.includes("loading") && (i.push(b), d.push(v));
      const u = d.length, f = ke(s);
      if (f && Lt.includes(f))
        return 0;
      f && (c = i.indexOf(f) / u * 100);
    }
    return c;
  }, o = x(
    (s) => {
      e.getSnapshot().context;
      const c = e.getSnapshot().value;
      if (c === "done" || c === "success" || c === "idle" || c === "ready") {
        clearInterval(s);
        return;
      }
      r((l) => l + 1);
    },
    [e]
  ), a = x(() => {
    const s = setInterval(() => {
      o(s);
    }, 1e3);
    return s;
  }, [o, e]);
  return w(() => {
    const s = a();
    return () => clearInterval(s);
  }, []), {
    name: Je(e),
    timeElapsed: t,
    value: ke(e),
    percentComplete: n(e),
    uniqueKey: Re(e)
  };
}, At = () => {
  const [e, t] = S(!1), { internalStatus: r } = _t();
  return w(() => {
    r === "ready" && t(!0);
  }, [r]), w(() => {
    r === "ready" && t(!0);
  }, []), e;
}, Er = () => {
  const [e, t] = S(!1), r = xt(), { services: n, percentComplete: o } = Nt(), a = x(async () => {
    for (const c of n) {
      const l = Re(c);
      Ne(
        `would save to db with snapshot__${l}:`,
        JSON.stringify(c.getPersistedSnapshot())
      );
    }
  }, [n]), s = x(async () => {
    const c = j.getAppDb();
    return c ? await c.select().from(fe).where(Qe(fe.key, "snapshot__%")) : [];
  }, []);
  w(() => !r || e ? void 0 : ((async () => {
    const l = await s();
    Ne("persistedSnapshots:", l), t(!0);
  })(), () => {
    a();
  }), [r, e]);
}, xt = () => {
  const [e, t] = S(!1), r = At();
  return w(() => {
    r && (async () => {
      const a = await j.getAppDb().select().from(fe).where(Qe(fe.key, "snapshot__%"));
      a && a.length > 0 && t(!0);
    })();
  }, [r]), e;
}, Nt = () => {
  const [e, t] = S([]), [r, n] = S(5);
  return w(() => {
    const a = ge().getService(), s = a;
    s.uniqueKey = "clientManager", t([s]);
    const c = a.subscribe((l) => {
      const i = l.value;
      let d = 0;
      i === P.IDLE ? d = 100 : i === P.ADD_MODELS_TO_DB ? d = 90 : i === P.ADD_MODELS_TO_STORE ? d = 80 : i === P.PROCESS_SCHEMA_FILES ? d = 70 : i === P.SAVE_CONFIG ? d = 60 : i === P.DB_INIT ? d = 50 : i === P.FILE_SYSTEM_INIT ? d = 30 : i === P.PLATFORM_CLASSES_INIT && (d = 10), n(d);
    });
    return () => {
      c.unsubscribe();
    };
  }, []), {
    services: e,
    percentComplete: r
  };
}, _t = () => {
  const t = ge().getService(), r = Le(t, (o) => o.value), n = Le(t, (o) => {
    const a = o.value;
    return a === P.DB_INIT || a === P.SAVE_CONFIG || a === P.PROCESS_SCHEMA_FILES || a === P.ADD_MODELS_TO_STORE || a === P.ADD_MODELS_TO_DB || a === P.IDLE ? "ready" : a;
  });
  return {
    status: r,
    internalStatus: n
  };
};
G("seedSdk:react:db");
const Lr = () => {
  const [e, t] = S(!1), r = x(() => {
    e || t(!0);
  }, []);
  return w(() => {
    let n;
    return (async () => {
      const s = ge().getService(), c = s.getSnapshot().value;
      if (c === P.DB_INIT || c === P.SAVE_CONFIG || c === P.PROCESS_SCHEMA_FILES || c === P.ADD_MODELS_TO_STORE || c === P.ADD_MODELS_TO_DB || c === P.IDLE) {
        r();
        return;
      }
      n = s.subscribe((l) => {
        const i = l.value;
        (i === P.DB_INIT || i === P.SAVE_CONFIG || i === P.PROCESS_SCHEMA_FILES || i === P.ADD_MODELS_TO_STORE || i === P.ADD_MODELS_TO_DB || i === P.IDLE) && (r(), n?.unsubscribe());
      });
    })(), () => {
      n && n.unsubscribe();
    };
  }, []), {
    dbsAreReady: e
  };
}, Ge = G("seedSdk:react:schema"), Dt = (e) => {
  const [t, r] = S(null), [n, o] = S(!!e), [a, s] = S(null), c = C(null), l = Q(), i = x((d) => {
    o(!0), s(null);
    try {
      const u = be.create(d, {
        waitForReady: !1
      });
      r(u);
      const f = u.getService();
      f.getSnapshot().value === "idle" ? (ue(() => o(!1)), s(null)) : o(!0), c.current = f.subscribe((h) => {
        h.value === "idle" ? (ue(() => o(!1)), s(null)) : o(!0);
      });
    } catch (u) {
      return Ge("[useSchema] Error creating schema:", u), s(u), r(null), o(!1), null;
    }
  }, []);
  return w(() => {
    if (c.current && (c.current.unsubscribe(), c.current = null), !l) {
      r(null), s(null), o(!1);
      return;
    }
    if (!e) {
      r(null), s(null), o(!1);
      return;
    }
    return i(e), () => {
      c.current && (c.current.unsubscribe(), c.current = null);
    };
  }, [e, l, i]), {
    schema: t,
    isLoading: n,
    error: a
  };
}, we = ["seed", "schemas"], Ar = () => {
  const e = Q(), t = Z(), r = C(void 0), n = C([]), {
    data: o = [],
    isLoading: a,
    error: s
  } = ee({
    queryKey: we,
    queryFn: () => be.all({ waitForReady: !0 }),
    enabled: e
  });
  n.current = o;
  const c = e ? j.getAppDb() : null, l = N(() => c ? c.select().from(X).orderBy(X.name, Ve(X.version)) : null, [c, e]), i = Y(l);
  return w(() => {
    if (typeof BroadcastChannel > "u") return;
    const d = new BroadcastChannel("seed-schemas-invalidate"), u = () => {
      t.invalidateQueries({ queryKey: we });
    };
    return d.addEventListener("message", u), () => {
      d.removeEventListener("message", u), d.close();
    };
  }, [t]), w(() => {
    if (!e || !i)
      return;
    const d = r.current, u = d ? JSON.stringify(d) : "undefined", f = i ? JSON.stringify(i) : "undefined";
    if (u === f && d !== void 0)
      return;
    r.current = i;
    const b = /* @__PURE__ */ new Set();
    for (const p of n.current) {
      const E = p.id || p.schemaFileId;
      if (E)
        b.add(E);
      else {
        const I = p.metadata?.name, m = p.version;
        I && m !== void 0 && b.add(`${I}:${m}`);
      }
    }
    const v = /* @__PURE__ */ new Set();
    for (const p of i)
      p.name !== "Seed Protocol" && (p.schemaFileId ? v.add(p.schemaFileId) : p.name != null && p.version !== void 0 && v.add(`${p.name}:${p.version}`));
    const h = b.size === v.size && [...b].every((p) => v.has(p)), y = b.size > 0 && v.size > 0 && [...v].some((p) => !b.has(p));
    !h && y && t.invalidateQueries({ queryKey: we });
  }, [e, i, t]), {
    schemas: o,
    isLoading: a,
    error: s
  };
}, xr = () => {
  const e = C(null), [t, r] = S(!1), [n, o] = S(null), a = x(() => o(null), []), s = x((c) => {
    o(null), r(!0), e.current?.unsubscribe(), e.current = null;
    const l = be.create(c, {
      waitForReady: !1
    }), i = l.getService().subscribe((d) => {
      if (d.value === "error") {
        const u = d.context._loadingError?.error;
        o(u instanceof Error ? u : new Error("Failed to create schema")), r(!1);
      }
      d.value === "idle" && (o(null), r(!1));
    });
    return e.current = i, l;
  }, []);
  return w(() => () => {
    e.current?.unsubscribe(), e.current = null;
  }, []), {
    createSchema: s,
    isLoading: t,
    error: n,
    resetError: a
  };
}, Nr = () => {
  const [e, t] = S(null), [r, n] = S({
    isLoading: !1,
    error: null
  });
  w(() => {
    if (!e) {
      n({ isLoading: !1, error: null });
      return;
    }
    const s = e.getService(), c = () => {
      const d = s.getSnapshot().context;
      n({
        isLoading: !!d._destroyInProgress,
        error: d._destroyError ? new Error(d._destroyError.message) : null
      });
    };
    c();
    const l = s.subscribe(c);
    return () => l.unsubscribe();
  }, [e]);
  const o = x(async (s) => {
    s && (t(s), await s.destroy());
  }, []), a = x(() => {
    e && e.getService().send({ type: "clearDestroyError" });
  }, [e]);
  return {
    destroy: o,
    isLoading: r.isLoading,
    error: r.error,
    resetError: a
  };
}, _r = () => {
  const [e, t] = S(), r = C(/* @__PURE__ */ new Map()), n = Q(), o = x(async () => {
    if (n)
      try {
        const a = await ct(), s = /* @__PURE__ */ new Set();
        for (const l of a) {
          const i = l.schema.metadata?.name;
          i && s.add(i);
        }
        const c = /* @__PURE__ */ new Map();
        for (const l of s)
          if (r.current.has(l)) {
            const i = r.current.get(l);
            c.set(l, i);
          } else {
            const i = be.create(l, {
              waitForReady: !1
            });
            c.set(l, i);
          }
        for (const [l, i] of r.current.entries())
          s.has(l) || i.unload();
        r.current = c, t(Array.from(c.values()));
      } catch (a) {
        Ge("Error fetching all schema versions from database:", a), t(null);
      }
  }, [n]);
  return w(() => {
    n && o();
  }, [n, o]), w(() => () => {
    r.current.forEach((a) => {
      a.unload();
    }), r.current.clear();
  }, []), e;
}, Dr = () => Dt(lt), Ft = (e) => ["seed", "models", e], $e = /* @__PURE__ */ new Map(), Ct = (e) => {
  const t = Q(), r = Z(), n = C([]), o = N(() => Ft(e), [e]), {
    data: a = [],
    isLoading: s,
    error: c
  } = ee({
    queryKey: o,
    queryFn: async () => {
      const y = r.getQueryData(o), p = await ae.all(e, { waitForReady: !1 });
      if (Array.isArray(y) && y.length > 0 && Array.isArray(p) && p.length === 0)
        return [...y];
      if (Array.isArray(p) && p.length === 0) {
        const E = r.getQueryData(o);
        if (Array.isArray(E) && E.length > 0)
          return [...E];
      }
      return p;
    },
    enabled: t && !!e
  }), l = e && typeof e == "string" ? e : "";
  a.length > 0 && $e.set(l, a);
  const i = n.current.length > 0 ? n.current : $e.get(l), d = e ? a.length > 0 ? a : i?.length ? i : a : a;
  n.current = d, w(() => {
    if (!e || typeof BroadcastChannel > "u") return;
    const y = new BroadcastChannel("seed-models-invalidate"), p = (E) => {
      const { schemaName: I, schemaFileId: m } = E.data || {};
      (e === I || e === m) && (r.invalidateQueries({ queryKey: o }), r.refetchQueries({ queryKey: o }));
    };
    return y.addEventListener("message", p), () => {
      y.removeEventListener("message", p), y.close();
    };
  }, [e, r, o]);
  const u = C(null), f = C(null);
  function b() {
    const y = j.getAppDb();
    return !y || !e ? null : y.select({
      modelFileId: ce.schemaFileId,
      modelName: ce.name
    }).from(X).innerJoin(ve, q(X.id, ve.schemaId)).innerJoin(ce, q(ve.modelId, ce.id)).where(
      re(
        q(X.schemaFileId, e),
        q(X.name, e)
      )
    );
  }
  const v = N(() => {
    if (!e || !t) return null;
    const y = { schemaId: e, ready: t }, p = u.current;
    if (p && p.schemaId === y.schemaId && p.ready === y.ready && f.current !== null)
      return f.current;
    const E = b();
    return E ? (u.current = y, f.current = E, E) : null;
  }, [e, t]), h = Y(v);
  return w(() => {
    if (!t || !h || !e) return;
    const y = /* @__PURE__ */ new Set();
    for (const m of n.current) {
      const _ = m.id || m.modelFileId;
      _ ? y.add(_) : m.modelName && y.add(m.modelName);
    }
    const p = /* @__PURE__ */ new Set();
    for (const m of h)
      m.modelFileId ? p.add(m.modelFileId) : m.modelName && p.add(m.modelName);
    const E = y.size === p.size && [...y].every((m) => p.has(m)), I = p.size > 0 && [...p].some((m) => !y.has(m));
    !E && I && r.invalidateQueries({ queryKey: o });
  }, [t, h, e, r, o]), {
    models: d,
    isLoading: s,
    error: c
  };
}, Rt = (e, t) => {
  const r = Q(), [n, o] = S(void 0), [a, s] = S(!1), [c, l] = S(null), i = C(void 0), [, d] = S(0), u = t == null;
  if (N(() => r ? u ? !!e : !!(e && t) : !1, [r, u, e, t]), w(() => {
    if (!r || !u || !e) {
      o(void 0), s(!1), l(null);
      return;
    }
    (async () => {
      try {
        s(!0), l(null);
        const p = await ae.createById(e);
        o(p || void 0), s(!1), l(null);
      } catch (p) {
        console.error("[useModel] Error looking up model by ID:", p), o(void 0), s(!1), l(p);
      }
    })();
  }, [r, u, e]), w(() => {
    if (!u || !n) {
      i.current?.unsubscribe(), i.current = void 0;
      return;
    }
    i.current?.unsubscribe();
    const y = n.getService().subscribe((p) => {
      d((E) => E + 1);
    });
    return i.current = y, () => {
      i.current?.unsubscribe(), i.current = void 0;
    };
  }, [u, n]), u)
    return {
      model: n,
      isLoading: a,
      error: c
    };
  const { models: f, isLoading: b, error: v } = Ct(e), h = N(() => {
    if (t)
      return f.find((y) => (y.modelName ?? y.name) === t);
  }, [f, t]);
  return w(() => {
    if (u || !h) {
      i.current?.unsubscribe(), i.current = void 0;
      return;
    }
    i.current?.unsubscribe();
    const y = h.getService().subscribe((p) => {
      d((E) => E + 1);
    });
    return i.current = y, () => {
      i.current?.unsubscribe(), i.current = void 0;
    };
  }, [u, h]), {
    model: h,
    isLoading: b,
    error: v
  };
}, Fr = () => {
  const e = C(void 0), [t, r] = S(!1), [n, o] = S(null), a = x(() => o(null), []), s = x(
    (c, l, i) => {
      o(null), r(!0), e.current?.unsubscribe(), e.current = void 0;
      const d = ae.create(l, c, {
        ...i,
        waitForReady: !1
      }), u = d.getService().subscribe((f) => {
        f.value === "error" && (o(
          f.context._loadingError?.error ?? new Error("Failed to create model")
        ), r(!1)), f.value === "idle" && (o(null), r(!1));
      });
      return e.current = u, d;
    },
    []
  );
  return w(() => () => {
    e.current?.unsubscribe(), e.current = void 0;
  }, []), {
    create: s,
    isLoading: t,
    error: n,
    resetError: a
  };
}, Cr = () => {
  const [e, t] = S(null), [r, n] = S({
    isLoading: !1,
    error: null
  });
  w(() => {
    if (!e) {
      n({ isLoading: !1, error: null });
      return;
    }
    const s = e.getService(), c = () => {
      const d = s.getSnapshot().context;
      n({
        isLoading: !!d._destroyInProgress,
        error: d._destroyError ? new Error(d._destroyError.message) : null
      });
    };
    c();
    const l = s.subscribe(c);
    return () => l.unsubscribe();
  }, [e]);
  const o = x(async (s) => {
    s && (t(s), await s.destroy());
  }, []), a = x(() => {
    e && e.getService().send({ type: "clearDestroyError" });
  }, [e]);
  return {
    destroy: o,
    isLoading: r.isLoading,
    error: r.error,
    resetError: a
  };
};
G("seedSdk:browser:react:modelProperty");
const Rr = (e, t) => {
  const { model: r } = Rt(e, t);
  N(() => {
    if (r)
      try {
        return r.modelName ?? r.name;
      } catch {
        return;
      }
  }, [r]);
  const n = Q(), o = Z(), a = N(() => {
    if (!r) return null;
    try {
      return r._getSnapshotContext()._dbId;
    } catch {
      return null;
    }
  }, [r]), s = r?.id, c = N(
    () => ["seed", "modelProperties", s ?? ""],
    [s]
  ), {
    data: l = [],
    isLoading: i,
    error: d
  } = ee({
    queryKey: c,
    queryFn: () => ye.all(s, { waitForReady: !0 }),
    enabled: n && !!s
  }), u = n ? j.getAppDb() : null, f = N(() => !u || !a ? null : u.select({
    id: te.id,
    name: te.name,
    dataType: te.dataType,
    schemaFileId: te.schemaFileId
  }).from(te).where(q(te.modelId, a)), [u, n, a]), b = Y(f), v = C([]);
  v.current = l, w(() => {
    if (!s || l.length > 0 || !o || !c) return;
    const p = [400, 1200, 2500].map(
      (E) => setTimeout(() => {
        o.invalidateQueries({ queryKey: c });
      }, E)
    );
    return () => p.forEach((E) => clearTimeout(E));
  }, [s, l.length, o, c]), w(() => {
    if (!n || !r?.id || !b || !c) return;
    const y = /* @__PURE__ */ new Set();
    for (const m of v.current) {
      const R = m._getSnapshotContext()?.id;
      R ? y.add(R) : m.name && y.add(m.name);
    }
    const p = /* @__PURE__ */ new Set();
    for (const m of b)
      m.schemaFileId ? p.add(m.schemaFileId) : m.name && p.add(m.name);
    !(y.size === p.size && (y.size === 0 || [...y].every((m) => p.has(m)))) && (y.size > 0 || p.size > 0) && o.invalidateQueries({ queryKey: c });
  }, [n, b, r?.id, o, c]);
  const h = i && l.length === 0;
  return {
    modelProperties: l,
    isLoading: h,
    error: d
  };
}, Pt = async (e, t) => {
  const r = await ae.createById(e);
  if (!r)
    return;
  const n = r.modelName ?? r.name;
  if (n)
    return ze(n, t);
};
function Pr(e, t, r) {
  const n = N(() => r != null ? !!(e && t && r) : t != null ? !!(e && t) : !!e, [e, t, r]), [o, a] = S(void 0), [s, c] = S(n), [l, i] = S(null), d = C(void 0), u = Q(), f = N(() => r != null ? { type: "schemaId", schemaId: e, modelName: t, propertyName: r } : t != null ? { type: "modelFileId", modelFileId: e, propertyName: t } : { type: "propertyFileId", propertyFileId: e }, [e, t, r]), b = N(() => u ? f.type === "propertyFileId" ? !!f.propertyFileId : f.type === "modelFileId" ? !!(f.modelFileId && f.propertyName) : !!(f.schemaId && f.modelName && f.propertyName) : !1, [u, f]), v = x(async () => {
    if (!u) {
      a(void 0), c(!1), i(null);
      return;
    }
    let y, p;
    try {
      if (c(!0), i(null), f.type === "propertyFileId") {
        if (!f.propertyFileId) {
          a(void 0), c(!1), i(null);
          return;
        }
        const E = await ye.createById(f.propertyFileId);
        E ? (a(E), c(!1), i(null)) : (a(void 0), c(!1), i(null));
        return;
      } else if (f.type === "modelFileId") {
        if (!f.modelFileId || !f.propertyName) {
          a(void 0), c(!1), i(null);
          return;
        }
        y = await Pt(f.modelFileId, f.propertyName);
        const E = await ae.createById(f.modelFileId);
        p = E?.modelName ?? E?.name;
      } else {
        if (!f.schemaId || !f.modelName || !f.propertyName) {
          a(void 0), c(!1), i(null);
          return;
        }
        y = await ze(f.modelName, f.propertyName), p = f.modelName;
      }
      if (y && p) {
        const E = ye.create(
          { ...y, modelName: p },
          { waitForReady: !1 }
        ), I = E instanceof Promise ? await E : E;
        ue(() => {
          a(I), c(!1), i(null);
        });
      } else
        a(void 0), c(!1), i(null);
    } catch (E) {
      console.error("[useModelProperty] Error updating model property:", E), a(void 0), c(!1), i(E);
    }
  }, [u, f.type, f.propertyFileId, f.modelFileId, f.propertyName, f.schemaId, f.modelName]);
  w(() => {
    if (!b) {
      a(void 0), c(!1), i(null);
      return;
    }
    v();
  }, [b, v]);
  const h = f.type === "propertyFileId";
  return w(() => {
    if (!o || !h)
      return;
    d.current?.unsubscribe();
    const y = He(v, 100), p = o.getService().subscribe(() => {
      y();
    });
    return d.current = p, () => {
      y.cancel(), d.current?.unsubscribe(), d.current = void 0;
    };
  }, [o, v, h]), {
    modelProperty: o,
    isLoading: s,
    error: l
  };
}
const Tr = () => {
  const e = C(void 0), [t, r] = S(!1), [n, o] = S(null), a = x(() => o(null), []), s = x(
    (c, l, i) => {
      if (o(null), r(!0), e.current?.unsubscribe(), e.current = void 0, !l || !i.name || !i.dataType) {
        const b = new Error("modelName, property name and dataType are required");
        throw o(b), r(!1), b;
      }
      const d = dt(c) ?? c, u = ye.create(
        { ...i, modelName: l },
        { waitForReady: !1, schemaName: d }
      ), f = u.getService().subscribe((b) => {
        if (b.value === "error") {
          const v = b.context._loadingError?.error ?? new Error("Failed to create model property");
          o(v instanceof Error ? v : new Error(String(v))), r(!1);
        }
        b.value === "idle" && (o(null), r(!1));
      });
      return e.current = f, u;
    },
    []
  );
  return w(() => () => {
    e.current?.unsubscribe(), e.current = void 0;
  }, []), {
    create: s,
    isLoading: t,
    error: n,
    resetError: a
  };
}, Mr = () => {
  const [e, t] = S(null), [r, n] = S({
    isLoading: !1,
    error: null
  });
  w(() => {
    if (!e) {
      n({ isLoading: !1, error: null });
      return;
    }
    const s = e.getService(), c = () => {
      const d = s.getSnapshot().context;
      n({
        isLoading: !!d._destroyInProgress,
        error: d._destroyError ? new Error(d._destroyError.message) : null
      });
    };
    c();
    const l = s.subscribe(c);
    return () => l.unsubscribe();
  }, [e]);
  const o = x(async (s) => {
    s && (t(s), await s.destroy());
  }, []), a = x(() => {
    e && e.getService().send({ type: "clearDestroyError" });
  }, [e]);
  return {
    destroy: o,
    isLoading: r.isLoading,
    error: r.error,
    resetError: a
  };
}, kr = () => {
  const [e, t] = S(null), [r, n] = S({
    isLoading: !1,
    error: null
  });
  w(() => {
    if (!e) {
      n({ isLoading: !1, error: null });
      return;
    }
    const s = e.getService(), c = () => {
      const d = s.getSnapshot().context;
      n({
        isLoading: !!d._destroyInProgress,
        error: d._destroyError ? new Error(d._destroyError.message) : null
      });
    };
    c();
    const l = s.subscribe(c);
    return () => l.unsubscribe();
  }, [e]);
  const o = x(async (s) => {
    s && (t(s), await s.destroy());
  }, []), a = x(() => {
    e && e.getService().send({ type: "clearDestroyError" });
  }, [e]);
  return {
    deleteItem: o,
    isLoading: r.isLoading,
    error: r.error,
    resetError: a
  };
}, Ie = ["seed", "imageFiles"];
function $r() {
  const e = Q(), t = Z(), {
    data: r = [],
    isLoading: n,
    error: o,
    refetch: a
  } = ee({
    queryKey: Ie,
    queryFn: () => W.listImageFiles(),
    enabled: e
  });
  return w(() => {
    const s = (l) => {
      l.includes("/images/") && t.invalidateQueries({ queryKey: Ie });
    }, c = () => {
      t.invalidateQueries({ queryKey: Ie });
    };
    return z.on("file-saved", s), z.on("fs.downloadAll.success", c), () => {
      z.off("file-saved", s), z.off("fs.downloadAll.success", c);
    };
  }, [t]), {
    imageFiles: r,
    isLoading: n,
    error: o instanceof Error ? o : null,
    refetch: a
  };
}
const Tt = ["seed", "files"];
function Br(e = "files") {
  const t = Q(), r = Z(), n = N(() => [...Tt, e], [e]), {
    data: o = [],
    isLoading: a,
    error: s,
    refetch: c
  } = ee({
    queryKey: n,
    queryFn: () => W.listFiles(e),
    enabled: t
  });
  return w(() => {
    const l = (d) => {
      d.includes(`/${e}/`) && r.invalidateQueries({ queryKey: n });
    }, i = () => {
      r.invalidateQueries({ queryKey: n });
    };
    return z.on("file-saved", l), z.on("fs.downloadAll.success", i), () => {
      z.off("file-saved", l), z.off("fs.downloadAll.success", i);
    };
  }, [r, e, n]), {
    files: o,
    isLoading: a,
    error: s instanceof Error ? s : null,
    refetch: c
  };
}
function Ye() {
  const e = j.getAppDb();
  return N(
    () => e ? e.select().from(pe).orderBy(Ve(pe.startedAt)) : null,
    [e]
  );
}
function Mt() {
  const e = Ye(), t = Y(e), r = N(
    () => t === void 0 ? void 0 : t.filter((n) => n.status !== "in_progress").length,
    [t]
  );
  return { records: t, nonActiveCount: r };
}
function Or() {
  const e = Ye();
  return Y(e);
}
function Ur() {
  return Mt().nonActiveCount;
}
function qr(e) {
  const t = j.getAppDb(), r = N(
    () => e != null && t ? t.select().from(pe).where(q(pe.id, e)).limit(1) : null,
    [t, e]
  ), n = Y(r), o = n === void 0;
  return { record: n && n.length > 0 ? n[0] : null, isLoading: o };
}
const kt = {
  queries: {
    networkMode: "offlineFirst",
    gcTime: 1e3 * 60 * 60 * 24,
    // 24 hours
    staleTime: 1e3 * 60
    // 1 minute - list data can be slightly stale
  }
};
function Xe() {
  return { ...kt };
}
function $t(e) {
  const t = Xe();
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
function Bt(e) {
  const t = Xe(), { defaultOptions: r, ...n } = e ?? {};
  return new bt({
    ...n,
    defaultOptions: r ? $t(r) : t
  });
}
let _e = null;
function zr(e) {
  const t = _e?.(e);
  return typeof window < "u" && window.__SEED_INVALIDATE_ITEM_PROPERTIES__ && window.__SEED_INVALIDATE_ITEM_PROPERTIES__(e), Promise.resolve(t).then(() => {
  });
}
function Ot({ queryClient: e }) {
  return w(() => {
    const t = (o) => {
      const a = ["seed", "itemProperties", o];
      return e.invalidateQueries({ queryKey: a }), e.refetchQueries({ queryKey: a });
    };
    _e = t, typeof window < "u" && (window.__SEED_INVALIDATE_ITEM_PROPERTIES__ = t);
    const r = (o) => {
      const a = o?.seedLocalId ?? o?.seedUid;
      a && t(a);
    }, n = () => {
      e.invalidateQueries({ queryKey: ["seed", "items"], exact: !1 });
    };
    return z.on("itemProperty.saved", r), z.on(ne, n), () => {
      z.off("itemProperty.saved", r), z.off(ne, n), _e = null, typeof window < "u" && (window.__SEED_INVALIDATE_ITEM_PROPERTIES__ = null);
    };
  }, [e]), null;
}
function Hr({ children: e, queryClient: t, queryClientRef: r }) {
  const n = N(
    () => t ?? Bt(),
    [t]
  );
  if (r && (r.current = n, typeof window < "u")) {
    const o = window;
    o.__TEST_SEED_QUERY_CLIENT__ = n;
    try {
      window.parent && window.parent !== window && (window.parent.__TEST_SEED_QUERY_CLIENT__ = n);
    } catch {
    }
  }
  return /* @__PURE__ */ g(St, { client: n, children: /* @__PURE__ */ U(wt, { queryClient: n, children: [
    /* @__PURE__ */ g(Ot, { queryClient: n }),
    e
  ] }) });
}
function Ut() {
  return /* @__PURE__ */ g(
    "div",
    {
      style: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        width: "100%"
      },
      children: "Loading..."
    }
  );
}
function Qr({
  initConfig: e,
  schema: t,
  loadingComponent: r,
  wrapperClassName: n,
  loadingClassName: o,
  children: a
}) {
  const s = Q();
  w(() => {
    const u = t ? {
      ...e,
      config: {
        ...e.config,
        schema: t
      }
    } : e;
    ut.init(u);
  }, [e, t]);
  const c = r ?? /* @__PURE__ */ g(Ut, {}), l = n ? void 0 : { position: "relative", display: "flex", height: "100vh", width: "100vw" }, i = {
    display: s ? "none" : "flex",
    ...!o && {
      position: "absolute",
      inset: 0,
      zIndex: 50,
      alignItems: "center",
      justifyContent: "center"
    }
  };
  return /* @__PURE__ */ U("div", { className: n, style: l, children: [
    /* @__PURE__ */ g(
      "div",
      {
        className: o,
        style: i,
        "aria-hidden": s,
        children: c
      }
    ),
    /* @__PURE__ */ g("div", { style: {
      flex: 1,
      display: s ? "flex" : "none",
      flexDirection: "column"
    }, children: a })
  ] });
}
async function Ze(e, t = "") {
  const r = [];
  try {
    for await (const [n, o] of e.entries()) {
      const a = t ? `${t}/${n}` : n;
      if (o.kind === "file")
        try {
          const s = await o.getFile();
          r.push({
            name: n,
            path: a,
            size: s.size,
            type: s.type || "application/octet-stream",
            lastModified: s.lastModified
          });
        } catch (s) {
          console.warn(`Failed to read file ${a}:`, s);
        }
      else if (o.kind === "directory") {
        const s = await Ze(o, a);
        r.push(...s);
      }
    }
  } catch (n) {
    console.warn(`Failed to scan directory ${t}:`, n);
  }
  return r;
}
function qt(e = {}) {
  const { rootPath: t } = e, [r, n] = S([]), [o, a] = S(!0), [s, c] = S(null), l = x(async () => {
    a(!0), c(null);
    try {
      let d = await navigator.storage.getDirectory();
      if (t) {
        const f = t.split("/").filter(Boolean);
        for (const b of f)
          d = await d.getDirectoryHandle(b);
      }
      const u = await Ze(d, t || "");
      n(u.sort((f, b) => f.path.localeCompare(b.path)));
    } catch (i) {
      c(
        "Failed to access OPFS: " + (i instanceof Error ? i.message : String(i))
      ), console.error("OPFS access error:", i);
    } finally {
      a(!1);
    }
  }, [t]);
  return w(() => {
    l();
  }, [l]), { files: r, isLoading: o, error: s, refetch: l };
}
const Be = () => /* @__PURE__ */ g("svg", { xmlns: "http://www.w3.org/2000/svg", fill: "none", viewBox: "0 0 24 24", strokeWidth: 1.5, stroke: "currentColor", style: { width: 20, height: 20 }, children: /* @__PURE__ */ g("path", { strokeLinecap: "round", strokeLinejoin: "round", d: "M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" }) }), zt = () => /* @__PURE__ */ g("svg", { xmlns: "http://www.w3.org/2000/svg", fill: "none", viewBox: "0 0 24 24", strokeWidth: 1.5, stroke: "currentColor", style: { width: 48, height: 48 }, children: /* @__PURE__ */ g("path", { strokeLinecap: "round", strokeLinejoin: "round", d: "M2.25 12.75V12a2.25 2.25 0 012.25-2.25h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" }) }), Ht = () => /* @__PURE__ */ g("svg", { xmlns: "http://www.w3.org/2000/svg", fill: "none", viewBox: "0 0 24 24", strokeWidth: 1.5, stroke: "currentColor", style: { width: 20, height: 20 }, children: /* @__PURE__ */ g("path", { strokeLinecap: "round", strokeLinejoin: "round", d: "M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" }) }), Oe = () => /* @__PURE__ */ g("svg", { xmlns: "http://www.w3.org/2000/svg", fill: "none", viewBox: "0 0 24 24", strokeWidth: 1.5, stroke: "currentColor", style: { width: 20, height: 20 }, children: /* @__PURE__ */ g("path", { strokeLinecap: "round", strokeLinejoin: "round", d: "M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" }) }), Qt = () => /* @__PURE__ */ U(
  "svg",
  {
    xmlns: "http://www.w3.org/2000/svg",
    fill: "none",
    viewBox: "0 0 24 24",
    style: { width: 32, height: 32 },
    "aria-hidden": !0,
    children: [
      /* @__PURE__ */ g(
        "circle",
        {
          style: { opacity: 0.25 },
          cx: "12",
          cy: "12",
          r: "10",
          stroke: "currentColor",
          strokeWidth: "4"
        }
      ),
      /* @__PURE__ */ g(
        "path",
        {
          style: { opacity: 0.75 },
          fill: "currentColor",
          d: "M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        }
      )
    ]
  }
);
function Vt(e) {
  if (e === 0) return "0 Bytes";
  const t = 1024, r = ["Bytes", "KB", "MB", "GB"], n = Math.floor(Math.log(e) / Math.log(t));
  return Math.round(e / Math.pow(t, n) * 100) / 100 + " " + r[n];
}
function Kt(e) {
  return new Date(e).toLocaleString();
}
async function jt(e, t) {
  const r = e.path.split("/").filter(Boolean);
  if (r.length === 0) throw new Error("Invalid file path");
  let n = t;
  for (let c = 0; c < r.length - 1; c++)
    n = await n.getDirectoryHandle(r[c]);
  const o = r[r.length - 1];
  return await (await n.getFileHandle(o)).getFile();
}
async function Ue(e, t) {
  const r = e.split("/").filter(Boolean);
  if (r.length === 0) throw new Error("Invalid file path");
  let n = t;
  for (let a = 0; a < r.length - 1; a++)
    n = await n.getDirectoryHandle(r[a]);
  const o = r[r.length - 1];
  await n.removeEntry(o);
}
const Wt = {
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
}, T = {
  container: { padding: "2rem 0" },
  header: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "1rem",
    marginBottom: "1rem"
  },
  title: { fontSize: "1.5rem", fontWeight: 600, margin: 0 },
  description: { fontSize: "0.875rem", margin: "0.5rem 0 0 0" },
  button: "rounded-md px-3 py-2 text-sm font-semibold border-0 cursor-pointer bg-indigo-600 text-white hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600",
  buttonDanger: "rounded-md px-3 py-2 text-sm font-semibold border-0 cursor-pointer bg-red-600 text-white hover:bg-red-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600",
  table: "min-w-full divide-y",
  tableHeader: "py-3.5 pl-4 pr-3 text-left text-sm font-semibold sm:pl-6",
  tableCell: "whitespace-nowrap py-4 pl-4 pr-3 text-sm sm:pl-6",
  errorBox: "rounded-md border p-4 mt-4",
  emptyState: "text-center py-12"
};
function Vr({
  rootPath: e,
  filter: t,
  onBeforeDelete: r,
  onAfterDelete: n,
  onDownload: o,
  title: a = "Files",
  description: s = "Browse and download all files stored in the Origin Private File System (OPFS).",
  theme: c = "dark",
  className: l
}) {
  const i = Wt[c], { files: d, isLoading: u, error: f, refetch: b } = qt({ rootPath: e }), v = t ? d.filter(t) : d, [h, y] = S(/* @__PURE__ */ new Set()), p = C(null), E = v.length > 0 && h.size === v.length, I = h.size > 0 && h.size < v.length, m = (L) => {
    y(($) => {
      const F = new Set($);
      return F.has(L) ? F.delete(L) : F.add(L), F;
    });
  }, _ = () => {
    y(
      h.size === v.length ? /* @__PURE__ */ new Set() : new Set(v.map((L) => L.path))
    );
  };
  w(() => {
    y(/* @__PURE__ */ new Set());
  }, [v.length]), w(() => {
    p.current && (p.current.indeterminate = I);
  }, [I]);
  const R = async (L, $ = !1) => {
    try {
      const F = await navigator.storage.getDirectory(), H = await jt(L, F);
      if (o)
        await o(L, H);
      else {
        const K = URL.createObjectURL(H), M = document.createElement("a");
        M.href = K, M.download = L.name, document.body.appendChild(M), M.click(), document.body.removeChild(M), URL.revokeObjectURL(K);
      }
    } catch (F) {
      const H = "Failed to download file: " + (F instanceof Error ? F.message : String(F));
      throw $ || alert(H), F;
    }
  }, A = async (L) => {
    if (!(r && !await r(L)) && confirm(`Are you sure you want to delete "${L.name}"? This action cannot be undone.`))
      try {
        const $ = await navigator.storage.getDirectory();
        await Ue(L.path, $), await b(), await n?.([L.path]);
      } catch ($) {
        alert("Failed to delete file: " + ($ instanceof Error ? $.message : String($)));
      }
  }, B = async () => {
    if (h.size === 0) return;
    const L = v.filter((F) => h.has(F.path)), $ = [];
    for (const F of L)
      try {
        await R(F, !0), await new Promise((H) => setTimeout(H, 100));
      } catch (H) {
        $.push(`${F.name}: ${H instanceof Error ? H.message : String(H)}`);
      }
    $.length > 0 && alert(`Some downloads failed:
${$.join(`
`)}`);
  }, V = async () => {
    if (h.size === 0) return;
    const L = v.filter((M) => h.has(M.path)), $ = L.map((M) => M.name).join(", ");
    if (!confirm(
      `Are you sure you want to delete ${h.size} file(s)?

Files: ${$}

This action cannot be undone.`
    ))
      return;
    const F = await navigator.storage.getDirectory(), H = [], K = [];
    for (const M of L)
      if (!(r && !await r(M)))
        try {
          await Ue(M.path, F), H.push(M.path);
        } catch (J) {
          K.push(`${M.name}: ${J instanceof Error ? J.message : String(J)}`);
        }
    y(/* @__PURE__ */ new Set()), await b(), H.length > 0 && await n?.(H), K.length > 0 && alert(`Some deletions failed:
${K.join(`
`)}`);
  };
  return /* @__PURE__ */ U("div", { className: l, style: T.container, children: [
    /* @__PURE__ */ g("style", { children: "@keyframes opfs-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}" }),
    /* @__PURE__ */ U("div", { style: T.header, children: [
      /* @__PURE__ */ U("div", { style: { flex: 1, minWidth: 0 }, children: [
        /* @__PURE__ */ g("h1", { style: T.title, className: i.title, children: a }),
        /* @__PURE__ */ g("p", { style: T.description, className: i.description, children: s })
      ] }),
      /* @__PURE__ */ g("button", { type: "button", onClick: b, className: T.button, children: "Refresh" })
    ] }),
    h.size > 0 && /* @__PURE__ */ U(
      "div",
      {
        className: `mt-4 flex items-center justify-between rounded-lg border px-4 py-3 ${i.batchBar}`,
        children: [
          /* @__PURE__ */ U("span", { className: `text-sm font-medium ${i.batchText}`, children: [
            h.size,
            " file",
            h.size === 1 ? "" : "s",
            " selected"
          ] }),
          /* @__PURE__ */ U("div", { className: "flex items-center gap-3", children: [
            /* @__PURE__ */ g("button", { onClick: B, className: T.button, children: /* @__PURE__ */ U("span", { className: "inline-flex items-center gap-2", children: [
              /* @__PURE__ */ g(Be, {}),
              " Download All"
            ] }) }),
            /* @__PURE__ */ g("button", { onClick: V, className: T.buttonDanger, children: /* @__PURE__ */ U("span", { className: "inline-flex items-center gap-2", children: [
              /* @__PURE__ */ g(Oe, {}),
              " Delete All"
            ] }) }),
            /* @__PURE__ */ g(
              "button",
              {
                onClick: () => y(/* @__PURE__ */ new Set()),
                className: `text-sm cursor-pointer bg-transparent border-0 ${i.clearButton}`,
                children: "Clear selection"
              }
            )
          ] })
        ]
      }
    ),
    /* @__PURE__ */ g("div", { className: "mt-8", children: u ? /* @__PURE__ */ U("div", { className: "flex justify-center items-center py-12 gap-3", children: [
      /* @__PURE__ */ g("span", { style: { animation: "opfs-spin 1s linear infinite" }, children: /* @__PURE__ */ g(Qt, {}) }),
      /* @__PURE__ */ g("span", { className: i.loadingText, children: "Loading files..." })
    ] }) : f ? /* @__PURE__ */ U("div", { className: `${T.errorBox} ${i.errorBox}`, children: [
      /* @__PURE__ */ g("h3", { className: `m-0 text-sm font-medium ${i.errorTitle}`, children: "Error" }),
      /* @__PURE__ */ g("div", { className: `mt-2 text-sm ${i.errorText}`, children: f })
    ] }) : v.length === 0 ? /* @__PURE__ */ U("div", { className: T.emptyState, children: [
      /* @__PURE__ */ g("span", { className: i.emptyIcon, children: /* @__PURE__ */ g(zt, {}) }),
      /* @__PURE__ */ g("h3", { className: `mt-2 text-sm font-semibold ${i.emptyTitle}`, children: "No files" }),
      /* @__PURE__ */ g("p", { className: `mt-1 text-sm ${i.emptyText}`, children: "No files found in OPFS." })
    ] }) : /* @__PURE__ */ g("div", { className: "overflow-x-auto", children: /* @__PURE__ */ U("table", { className: T.table, children: [
      /* @__PURE__ */ g("thead", { children: /* @__PURE__ */ U("tr", { className: i.tableBorder, children: [
        /* @__PURE__ */ g("th", { className: `${T.tableHeader} w-10 ${i.tableHeader}`, children: /* @__PURE__ */ g(
          "input",
          {
            ref: p,
            type: "checkbox",
            checked: E,
            onChange: _,
            "aria-label": "Select all"
          }
        ) }),
        /* @__PURE__ */ g("th", { className: `${T.tableHeader} ${i.tableHeader}`, children: "Name" }),
        /* @__PURE__ */ g("th", { className: `${T.tableHeader} ${i.tableHeader}`, children: "Path" }),
        /* @__PURE__ */ g("th", { className: `${T.tableHeader} ${i.tableHeader}`, children: "Size" }),
        /* @__PURE__ */ g("th", { className: `${T.tableHeader} ${i.tableHeader}`, children: "Type" }),
        /* @__PURE__ */ g("th", { className: `${T.tableHeader} ${i.tableHeader}`, children: "Modified" }),
        /* @__PURE__ */ g(
          "th",
          {
            className: `${T.tableHeader} w-24 ${i.tableHeader}`,
            "aria-label": "Actions"
          }
        )
      ] }) }),
      /* @__PURE__ */ g("tbody", { className: `divide-y ${i.tableBorder}`, children: v.map((L) => /* @__PURE__ */ U("tr", { className: i.tableRow, children: [
        /* @__PURE__ */ g("td", { className: `${T.tableCell} ${i.tableCell}`, children: /* @__PURE__ */ g(
          "input",
          {
            type: "checkbox",
            checked: h.has(L.path),
            onChange: () => m(L.path),
            "aria-label": `Select ${L.name}`
          }
        ) }),
        /* @__PURE__ */ g("td", { className: `${T.tableCell} ${i.tableCell}`, children: /* @__PURE__ */ U("span", { className: "flex items-center gap-2", children: [
          /* @__PURE__ */ g(Ht, {}),
          L.name
        ] }) }),
        /* @__PURE__ */ g("td", { className: `${T.tableCell} ${i.tableCellMuted}`, children: /* @__PURE__ */ g("code", { className: `text-xs px-2 py-1 rounded border ${i.codeBlock}`, children: L.path }) }),
        /* @__PURE__ */ g("td", { className: `${T.tableCell} ${i.tableCellMuted}`, children: Vt(L.size) }),
        /* @__PURE__ */ g("td", { className: `${T.tableCell} ${i.tableCellMuted}`, children: L.type }),
        /* @__PURE__ */ g("td", { className: `${T.tableCell} ${i.tableCellMuted}`, children: Kt(L.lastModified) }),
        /* @__PURE__ */ g("td", { className: T.tableCell, children: /* @__PURE__ */ U("div", { className: "flex gap-2 justify-end", children: [
          /* @__PURE__ */ g(
            "button",
            {
              type: "button",
              onClick: () => R(L),
              title: "Download",
              className: `p-1.5 rounded cursor-pointer bg-transparent border-0 transition-colors ${i.actionButton}`,
              children: /* @__PURE__ */ g(Be, {})
            }
          ),
          /* @__PURE__ */ g(
            "button",
            {
              type: "button",
              onClick: () => A(L),
              title: "Delete",
              className: `p-1.5 rounded cursor-pointer bg-transparent border-0 transition-colors ${i.deleteButton}`,
              children: /* @__PURE__ */ g(Oe, {})
            }
          )
        ] }) })
      ] }, L.path)) })
    ] }) }) })
  ] });
}
const Ee = G("seedSdk:react:SeedImage"), de = /* @__PURE__ */ new Map(), et = (e) => {
  const t = /^(.*[\/\\])?([^\/\\]+?)(\.[^.\/\\]*)?$/, r = e.match(t);
  return r && r[2] ? r[2] : e;
};
function Jt(e) {
  return e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function Gt(e, t) {
  const r = new RegExp(`^${Jt(t)}$`), n = et(e);
  return r.test(n);
}
const Yt = ({ imageProperty: e, width: t, filename: r, ...n }) => {
  const [o, a] = S(), [s, c] = S(), { property: l } = We({
    propertyName: e.propertyName,
    seedLocalId: e.seedLocalId,
    seedUid: e.seedUid
  }), i = e ?? l, d = r ?? i?.refResolvedValue ?? i?.value, u = i?.value, f = typeof u == "string" ? u : d, b = u != null && (u instanceof File || u instanceof Blob), [v, h] = S(null), y = qe.useRef(null);
  w(() => {
    if (b && (u instanceof File || u instanceof Blob))
      return y.current || (y.current = URL.createObjectURL(u), h(y.current)), () => {
        y.current && (URL.revokeObjectURL(y.current), y.current = null), h(null);
      };
    y.current = null, h(null);
  }, [b, u]), w(() => {
    if (!d || u && ((A) => typeof A == "string" && A.startsWith("blob:"))(u) || v) return;
    let _ = !1;
    return (async () => {
      try {
        const A = i?.localStoragePath ? i.localStoragePath : `${W.getFilesPath("images")}/${d}`;
        if (await W.pathExists(A)) {
          const V = await W.getContentUrlFromPath(A);
          !_ && V && c(V);
        }
      } catch (A) {
        Ee("_getOriginalContentUrl error", A);
      }
    })(), () => {
      _ = !0;
    };
  }, [d, u, v, i?.localStoragePath]), w(() => {
    if (!t || !d)
      return;
    (async () => {
      try {
        const _ = await W.getFs(), R = i?.localStoragePath ? i.localStoragePath.split("/").slice(0, -1).join("/") : W.getFilesPath("images"), V = _.readdirSync(R, { withFileTypes: !0 }).filter((O) => O.isDirectory()).map((O) => parseInt(O.name)), L = V.reduce((O, se) => Math.abs(se - t) < Math.abs(O - t) ? se : O, V[0]), $ = et(d), F = `${$}-${L}`;
        if (de.has(F))
          try {
            const O = de.get(F);
            if (O && (await fetch(O)).ok) {
              a(O);
              return;
            }
          } catch (O) {
            Ee("error", O), de.delete(F);
          }
        const K = _.readdirSync(`${R}/${L}`, { withFileTypes: !0 }).find((O) => O.name ? Gt(O.name, $) : !1);
        if (!K)
          return;
        const M = `${R}/${L}/${K?.name}`;
        if (await W.pathExists(M)) {
          const O = await W.getContentUrlFromPath(M);
          O && (de.set(F, O), a(O));
        }
      } catch (_) {
        Ee("_getSizedContentUrl error", _);
      }
    })();
  }, [i, t, f, d]);
  const p = (m) => typeof m == "string" && m.startsWith("blob:");
  if (!(!!o || !!s || !!v || !!f && p(f)) && !d)
    return null;
  const I = o || s || v || (p(f) ? f : void 0) || "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
  return /* @__PURE__ */ g("img", { src: I, alt: n.alt || e.propertyName || "Image", ...n });
}, Kr = qe.memo(
  Yt,
  (e, t) => e.imageProperty === t.imageProperty && e.width === t.width && e.filename === t.filename
);
function tt(e) {
  const { value: t, enabled: r = !0, treatAs: n } = e, [o, a] = S(0), [s, c] = S(null), [l, i] = S(null), [d, u] = S("idle");
  w(() => {
    let h = !1;
    return (async () => {
      if (!r || t == null || String(t).trim() === "") {
        h || (c(null), i(null), u("idle"));
        return;
      }
      h || (u("loading"), i(null));
      try {
        const p = await ft(String(t), { treatAs: n });
        if (h) return;
        c(p), p.status === "empty" ? u("empty") : p.status === "ready" ? u("ready") : u("unresolved");
      } catch (p) {
        if (h) return;
        i(p instanceof Error ? p : new Error(String(p))), c(null), u("error");
      }
    })(), () => {
      h = !0;
    };
  }, [r, t, n, o]);
  const f = x(() => {
    a((h) => h + 1);
  }, []), b = s && s.status === "ready" ? s.href : void 0, v = s && s.status === "ready" ? s.source : void 0;
  return {
    href: b,
    status: d,
    source: v,
    error: l,
    result: s,
    refetch: f
  };
}
function jr({
  value: e,
  enabled: t,
  treatAs: r,
  render: n,
  alt: o,
  ...a
}) {
  const { href: s } = tt({ value: e, enabled: t, treatAs: r });
  if (!s)
    return null;
  const c = { ...a, src: s, alt: o ?? "" };
  return n ? /* @__PURE__ */ g(Se, { children: n(c) }) : /* @__PURE__ */ g("img", { ...c });
}
function Xt(e) {
  try {
    return new URL(e).pathname.split("/").filter(Boolean).pop() || "Open";
  } catch {
    return "Open";
  }
}
function Zt(e) {
  try {
    const t = new URL(e).protocol;
    return t === "http:" || t === "https:";
  } catch {
    return !1;
  }
}
function Wr({
  value: e,
  enabled: t,
  treatAs: r,
  download: n,
  render: o,
  children: a,
  target: s,
  rel: c,
  ...l
}) {
  const { href: i } = tt({ value: e, enabled: t, treatAs: r });
  if (!i)
    return null;
  const d = Zt(i), u = s !== void 0 ? s : d ? "_blank" : void 0, f = {
    ...l,
    href: i,
    download: n,
    target: u,
    rel: c ?? (d && u === "_blank" ? "noopener noreferrer" : void 0),
    children: a ?? Xt(i)
  };
  return o ? /* @__PURE__ */ g(Se, { children: o(f) }) : /* @__PURE__ */ g("a", { ...f });
}
function er(e) {
  return typeof e == "string" && e.trim().length > 0;
}
function Jr({
  html: e,
  sanitize: t,
  render: r,
  ...n
}) {
  if (!er(e))
    return null;
  const o = t(e);
  return r ? /* @__PURE__ */ g(Se, { children: r({ html: o }) }) : /* @__PURE__ */ g("div", { ...n, dangerouslySetInnerHTML: { __html: o } });
}
function De(e, t) {
  return e.length <= t ? e : `${e.slice(0, t)}…`;
}
function tr(e) {
  const t = e.trim();
  return t.startsWith("{") && t.endsWith("}") || t.startsWith("[") && t.endsWith("]");
}
function Fe(e, t, r, n, o) {
  if (typeof e == "bigint")
    return String(e);
  if (typeof e == "symbol")
    return e.toString();
  if (typeof e == "function")
    return "[Function]";
  if (e instanceof Date)
    return e.toISOString();
  if (typeof e == "string")
    return De(e, r);
  if (e === null || typeof e != "object")
    return e;
  if (o.has(e))
    return "[Circular]";
  if (n >= t)
    return "[Max depth]";
  if (o.add(e), Array.isArray(e))
    return e.map((s) => Fe(s, t, r, n + 1, o));
  const a = {};
  for (const [s, c] of Object.entries(e))
    a[s] = Fe(c, t, r, n + 1, o);
  return a;
}
function rr(e, t) {
  const r = t?.maxDepth ?? 6, n = t?.maxStringLength ?? 5e4, o = t?.space ?? 2;
  if (e === void 0)
    return "undefined";
  if (e === null)
    return "null";
  let a = e;
  if (typeof e == "string")
    if (tr(e))
      try {
        a = JSON.parse(e);
      } catch {
        return De(e, n);
      }
    else
      return De(e, n);
  const s = Fe(a, r, n, 0, /* @__PURE__ */ new WeakSet());
  try {
    return JSON.stringify(s, null, o);
  } catch {
    return "[Unserializable JSON]";
  }
}
function Gr({
  value: e,
  format: t,
  formatOptions: r,
  render: n,
  ...o
}) {
  const a = t ? t(e) : rr(e, r);
  return n ? /* @__PURE__ */ g(Se, { children: n({ text: a }) }) : /* @__PURE__ */ g("pre", { ...o, children: a });
}
function Yr(e, t) {
  return N(() => e ? yt(e, t) : {}, [e, t]);
}
export {
  Me as ADDRESSES_PERSISTED_EVENT,
  Tt as FILES_QUERY_KEY_PREFIX,
  Vr as OPFSFilesManager,
  Qr as SeedClientGate,
  Jr as SeedHtml,
  Kr as SeedImage,
  Gr as SeedJson,
  Wr as SeedMediaFile,
  jr as SeedMediaImage,
  Hr as SeedProvider,
  Bt as createSeedQueryClient,
  rr as formatSeedJson,
  Xe as getSeedQueryDefaultOptions,
  Je as getServiceName,
  Re as getServiceUniqueKey,
  ke as getServiceValue,
  zr as invalidateItemPropertiesForItem,
  $t as mergeSeedQueryDefaults,
  _r as useAllSchemaVersions,
  hr as useCreateItem,
  vr as useCreateItemProperty,
  Fr as useCreateModel,
  Tr as useCreateModelProperty,
  xr as useCreateSchema,
  Lr as useDbsAreReady,
  br as useDebouncedItemProperty,
  kr as useDeleteItem,
  wr as useDestroyItemProperty,
  Cr as useDestroyModel,
  Mr as useDestroyModelProperty,
  Nr as useDestroySchema,
  qr as useEasSyncProcessById,
  Or as useEasSyncProcesses,
  Ur as useEasSyncProcessesNonActiveCount,
  Mt as useEasSyncProcessesState,
  Br as useFiles,
  _t as useGlobalServiceStatus,
  xt as useHasSavedSnapshots,
  $r as useImageFiles,
  At as useIsDbReady,
  pr as useItem,
  Sr as useItemProperties,
  We as useItemProperty,
  mr as useItems,
  Y as useLiveQuery,
  Rt as useModel,
  Rr as useModelProperties,
  Pr as useModelProperty,
  Ct as useModels,
  Yr as useNormalizedFeedItemFields,
  qt as useOPFSFiles,
  Er as usePersistedSnapshots,
  gr as usePublishItem,
  tt as useResolvedMediaRef,
  Dt as useSchema,
  Ar as useSchemas,
  je as useSeedAddressRevision,
  Dr as useSeedProtocolSchema,
  Ir as useService,
  Nt as useServices
};
//# sourceMappingURL=index.js.map
