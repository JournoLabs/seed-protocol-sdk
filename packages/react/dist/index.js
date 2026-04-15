import Oe, { createContext as Xe, useContext as Ze, useState as S, useCallback as x, useEffect as I, useRef as D, useMemo as F, useLayoutEffect as et } from "react";
import { flushSync as de } from "react-dom";
import { getClient as me, ClientManagerState as C, eventEmitter as K, BaseDb as W, Item as _e, getAddressesForItemsFilter as tt, seeds as A, getVersionData as rt, createNewItem as nt, ItemProperty as se, metadata as T, appState as ue, Schema as he, schemas as Y, loadAllSchemasFromDb as st, SEED_PROTOCOL_SCHEMA_NAME as ot, Model as oe, models as ae, modelSchemas as be, ModelProperty as fe, properties as ee, getPropertySchema as Ue, getSchemaNameFromId as it, BaseFileManager as j, client as at, resolveMediaRef as lt, normalizeFeedItemFields as ct } from "@seedprotocol/sdk";
import { orderBy as dt, debounce as ze, startCase as Ce } from "lodash-es";
import G from "debug";
import { useSelector as Ie } from "@xstate/react";
import { jsx as h, jsxs as O, Fragment as ge } from "react/jsx-runtime";
import { or as te, isNull as le, eq as U, inArray as Re, sql as ut, isNotNull as Ee, and as Le, gt as ft, like as qe, desc as pt } from "drizzle-orm";
import { toSnakeCase as yt } from "drizzle-orm/casing";
import { useQueryClient as X, useQuery as Z, QueryClient as mt, QueryClientProvider as ht } from "@tanstack/react-query";
import gt from "pluralize";
const q = () => {
  const t = me().getService();
  return Ie(t, (n) => n.value === C.IDLE);
}, Pe = "addresses.persisted", He = Xe(0);
function Qe() {
  return Ze(He);
}
function bt({
  queryClient: e,
  children: t
}) {
  const [r, n] = S(0), o = x(() => {
    e.invalidateQueries({ queryKey: ["seed", "items"], exact: !1 }), n((a) => a + 1);
  }, [e]);
  return I(() => (K.on(Pe, o), () => {
    K.off(Pe, o);
  }), [o]), /* @__PURE__ */ h(He.Provider, { value: r, children: t });
}
function ie(e) {
  const [t, r] = S(void 0), n = D(null), o = q(), a = F(() => {
    if (!o || !e)
      return null;
    try {
      return W.liveQuery(e);
    } catch (s) {
      return console.error("[useLiveQuery] Failed to create live query:", s), null;
    }
  }, [e, o]);
  return I(() => {
    if (n.current && (n.current.unsubscribe(), n.current = null), !a)
      return;
    const s = a.subscribe({
      next: (l) => {
        r(l !== void 0 ? [...l] : void 0);
      },
      error: (l) => {
        console.error("[useLiveQuery] Error:", l);
      }
    });
    return n.current = s, () => {
      n.current && (n.current.unsubscribe(), n.current = null);
    };
  }, [a]), t;
}
const pe = G("seedSdk:react:item"), dr = ({ modelName: e, seedLocalId: t, seedUid: r }) => {
  const [n, o] = S(), [a, s] = S(!!(t || r)), [l, c] = S(null), i = D(void 0), d = D(!1), u = q(), f = Qe(), g = D(e), v = D(t), b = D(r), y = F(() => u ? !!(v.current || b.current) : !1, [u, t, r]), p = x(async () => {
    if (!!!(u && (v.current || b.current))) {
      o(void 0), s(!1), c(null);
      return;
    }
    try {
      c(null);
      const w = await _e.find({
        modelName: g.current,
        seedLocalId: v.current,
        seedUid: b.current
      });
      if (!w) {
        pe("[useItem] [loadItem] no item found", g.current, v.current), o((m) => m && (m.seedLocalId && m.seedLocalId === v.current || m.seedUid && m.seedUid === b.current) ? m : void 0), s(!1), c(null);
        return;
      }
      o(w), s(!1), c(null);
    } catch (w) {
      pe("[useItem] Error loading item:", w), o(void 0), s(!1), c(w);
    }
  }, [u]);
  return I(() => {
    g.current = e, v.current = t, b.current = r;
  }, [e, t, r]), I(() => {
    if (!y) {
      !t && !r && (o(void 0), s(!1), c(null));
      return;
    }
    p();
  }, [y, p, t, r, f]), I(() => {
    if (!n) {
      i.current?.unsubscribe(), i.current = void 0, d.current = !1;
      return;
    }
    i.current?.unsubscribe(), d.current = !1;
    const w = n.getService().subscribe((m) => {
      m && typeof m == "object" && "value" in m && (m.value === "idle" ? (d.current = !0, s(!1), c(null)) : m.value === "error" ? (c(new Error("Item service error")), s(!1)) : d.current && s(!0));
    });
    return i.current = w, () => {
      i.current?.unsubscribe(), i.current = void 0;
    };
  }, [n]), {
    item: n,
    isLoading: a,
    error: l
  };
}, vt = (e, t, r, n, o) => [
  "seed",
  "items",
  e ?? null,
  t ?? !1,
  r ?? !1,
  n ?? null,
  o ?? 0
], ur = ({
  modelName: e,
  deleted: t = !1,
  includeEas: r = !1,
  addressFilter: n
}) => {
  const o = q(), a = Qe(), s = X(), l = D([]), c = D(/* @__PURE__ */ new Set()), i = D(!1), [d, u] = S(null);
  I(() => {
    if (n !== "owned" && n !== "watched") {
      u(null);
      return;
    }
    let w = !1;
    return tt(n).then((m) => {
      w || u(m);
    }), () => {
      w = !0;
    };
  }, [n, a]);
  const f = F(
    () => vt(e, t, r, n, a),
    [e, t, r, n, a]
  );
  I(() => {
    i.current = !1;
  }, [f]);
  const {
    data: g = [],
    isLoading: v,
    error: b
  } = Z({
    queryKey: f,
    queryFn: () => _e.all(e, t, { waitForReady: !0, includeEas: r, addressFilter: n }),
    enabled: o,
    // Local SQLite + live invalidation drive freshness; Seed’s default staleTime would keep a
    // mistaken initial [] “fresh” and block refetch when another subscriber mounts.
    staleTime: 0
  });
  l.current = g;
  const y = o ? W.getAppDb() : null, p = F(() => {
    if (!y || (n === "owned" || n === "watched") && d === null)
      return null;
    const w = [];
    r || w.push(te(le(A.uid), U(A.uid, ""))), e && w.push(U(A.type, yt(e))), n === "owned" ? d && d.length > 0 && w.push(
      te(
        Re(A.publisher, d),
        le(A.publisher)
      )
    ) : n === "watched" && (d && d.length > 0 ? w.push(Re(A.publisher, d)) : w.push(ut`1=0`)), t ? w.push(
      te(
        Ee(A._markedForDeletion),
        U(A._markedForDeletion, 1)
      )
    ) : (w.push(
      te(
        le(A._markedForDeletion),
        U(A._markedForDeletion, 0)
      )
    ), w.push(
      te(le(A.revokedAt), U(A.revokedAt, 0))
    ));
    const m = rt();
    return y.with(m).select({
      localId: A.localId,
      uid: A.uid,
      type: A.type,
      schemaUid: A.schemaUid,
      createdAt: A.createdAt,
      attestationCreatedAt: A.attestationCreatedAt,
      _markedForDeletion: A._markedForDeletion
    }).from(A).leftJoin(m, U(A.localId, m.seedLocalId)).where(Le(ft(m.versionsCount, 0), ...w)).groupBy(A.localId);
  }, [y, o, e, t, r, n, d]), E = ie(p);
  return I(() => {
    if (!o || !E) return;
    const w = /* @__PURE__ */ new Set();
    for (const N of E) {
      const $ = N.localId || N.uid;
      $ && w.add($);
    }
    const m = /* @__PURE__ */ new Set();
    for (const N of l.current) {
      const $ = N.seedLocalId || N.seedUid;
      $ && m.add($);
    }
    if (w.size === 0 && m.size > 0) return;
    if (!i.current && (i.current = !0, w.size > 0 && m.size === 0)) {
      c.current = new Set(w), s.invalidateQueries({ queryKey: f });
      return;
    }
    const P = c.current;
    if (P.size === w.size && [...P].every((N) => w.has(N)))
      return;
    if (m.size === w.size && [...m].every((N) => w.has(N))) {
      c.current = new Set(w);
      return;
    }
    c.current = new Set(w), s.invalidateQueries({ queryKey: f });
  }, [o, E, s, f]), {
    items: dt(
      g,
      [
        (w) => w.lastVersionPublishedAt || w.attestationCreatedAt || w.createdAt
      ],
      ["desc"]
    ),
    isLoading: v,
    error: b
  };
}, fr = () => {
  const [e, t] = S(!1), [r, n] = S(null), o = x(() => n(null), []);
  return {
    createItem: x(
      async (s, l) => {
        if (e) {
          pe("[useCreateItem] [createItem] already creating item, skipping");
          return;
        }
        n(null), de(() => t(!0));
        try {
          const c = l ?? {}, { seedLocalId: i } = await nt({ modelName: s, ...c });
          return await _e.find({ modelName: s, seedLocalId: i }) ?? void 0;
        } catch (c) {
          pe("[useCreateItem] Error creating item:", c), n(c instanceof Error ? c : new Error(String(c)));
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
}, pr = () => {
  const [e, t] = S(null), [r, n] = S(!1), [o, a] = S(null), s = D(void 0), l = x(() => a(null), []), c = x((i) => {
    i && (t(i), a(null), i.publish().catch(() => {
    }));
  }, []);
  return I(() => {
    if (!e) {
      s.current?.unsubscribe(), s.current = void 0, n(!1);
      return;
    }
    s.current?.unsubscribe();
    const i = e.getService(), d = i.subscribe((v) => {
      const b = v?.value, y = v?.context;
      n(b === "publishing");
      const p = y?._publishError;
      a(p ? new Error(p.message) : null);
    });
    s.current = d;
    const u = i.getSnapshot();
    n(u?.value === "publishing");
    const g = u?.context?._publishError;
    return a(g ? new Error(g.message) : null), () => {
      s.current?.unsubscribe(), s.current = void 0;
    };
  }, [e]), {
    publishItem: c,
    isLoading: r,
    error: o,
    resetError: l
  };
}, ye = G("seedSdk:react:property"), ne = G("seedSdk:react:itemProperties");
function Ve(e, t) {
  const r = q(), [n, o] = S(void 0), [a, s] = S(!1), [l, c] = S(null), i = D(void 0), [, d] = S(0), f = typeof e == "object" && e != null ? e : null, g = f?.itemId, v = f?.seedLocalId, b = f?.seedUid, y = f?.propertyName, p = typeof e == "string" ? e : g !== void 0 && g !== "" ? g : void 0, w = y ?? (typeof e == "string" ? t : void 0), m = F(() => {
    const N = p !== void 0 && p !== "" ? p : v, $ = p !== void 0 && p !== "" ? void 0 : b;
    return (N != null || $ != null) && w != null && w !== "" ? {
      type: "identifiers",
      seedLocalId: N ?? void 0,
      seedUid: $,
      propertyName: w
    } : null;
  }, [p, w, v, b]);
  F(() => m ? !!((m.seedLocalId || m.seedUid) && m.propertyName) : !1, [m]);
  const P = F(() => !r || !m ? !1 : !!((m.seedLocalId || m.seedUid) && m.propertyName), [r, m]);
  et(() => {
    P && s(!0);
  }, [P]);
  const H = x(async () => {
    if (!r || !m) {
      o(void 0), s(!1), c(null);
      return;
    }
    try {
      s(!0), c(null);
      const N = m.seedLocalId, $ = m.seedUid;
      if (!N && !$) {
        o(void 0), s(!1), c(null);
        return;
      }
      const Q = await se.find({
        propertyName: m.propertyName,
        seedLocalId: N,
        seedUid: $
      });
      if (!Q) {
        ye(
          `[useItemProperty] [updateItemProperty] no property found for Item.${N || $}.${m.propertyName}`
        ), o(void 0), s(!1), c(null);
        return;
      }
      o(Q), s(!1), c(null);
    } catch (N) {
      ye("[useItemProperty] Error updating item property:", N), o(void 0), s(!1), c(N);
    }
  }, [r, m]);
  return I(() => {
    if (!P) {
      o(void 0), s(!1), c(null);
      return;
    }
    n && m && n.propertyName === m.propertyName && (m.seedLocalId != null && n.seedLocalId === m.seedLocalId || m.seedUid != null && n.seedUid === m.seedUid) || H();
  }, [P, H, n, m]), I(() => {
    if (!n) {
      i.current?.unsubscribe(), i.current = void 0;
      return;
    }
    i.current?.unsubscribe();
    let N = 0, $ = !1, Q;
    const L = 50, k = n.getService().subscribe((_) => {
      if (_ && typeof _ == "object" && "value" in _ && _.value === "idle") {
        s(!1), c(null);
        const M = _.context, J = JSON.stringify([M.renderValue, M.propertyValue]);
        (!$ || J !== Q) && ($ = !0, Q = J, d((re) => re + 1));
        return;
      }
      $ = !1, Q = void 0;
      const V = Date.now();
      V - N >= L && (N = V, d((M) => M + 1));
    });
    return i.current = k, () => {
      i.current?.unsubscribe(), i.current = void 0;
    };
  }, [n]), {
    property: n,
    isLoading: a,
    error: l
  };
}
function yr(e, t = 300) {
  const r = "itemId" in e ? e.itemId : void 0, n = "seedLocalId" in e ? e.seedLocalId : void 0, o = "seedUid" in e ? e.seedUid : void 0, a = e.propertyName, s = F(() => r ? { seedLocalId: r, propertyName: a } : { seedLocalId: n, seedUid: o, propertyName: a }, [r, n, o, a]), { property: l, isLoading: c, error: i } = Ve(s), d = D(""), u = F(
    () => ze((g) => {
      g.getService().send({
        type: "save",
        newValue: d.current
      });
    }, t),
    [t]
  );
  I(() => () => u.cancel(), [u]);
  const f = x(
    (g) => {
      l && (d.current = g, l.getService().send({
        type: "updateContext",
        propertyValue: g,
        renderValue: g
      }), u(l));
    },
    [l, u]
  );
  return {
    property: l,
    setValue: f,
    isLoading: c,
    error: i
  };
}
async function St(e, t) {
  if (!e && !t) return [];
  const r = W.getAppDb();
  if (!r) return [];
  const n = await se.all(
    { seedLocalId: e ?? void 0, seedUid: t ?? void 0 },
    { waitForReady: !0 }
  ), o = [...n], a = /* @__PURE__ */ new Set();
  for (const c of n)
    c.propertyName && a.add(c.propertyName);
  let s;
  if (n.length > 0) {
    const c = n[0];
    s = c.modelName ?? c.modelType, s && typeof s == "string" && (s = Ce(s));
  }
  if (!s) {
    const c = await r.select({ type: A.type }).from(A).where(t ? U(A.uid, t) : U(A.localId, e)).limit(1);
    c.length > 0 && c[0].type && (s = Ce(c[0].type));
  }
  const l = [];
  if (s)
    try {
      const { Model: c } = await import("@seedprotocol/sdk"), i = await c.getByNameAsync(s);
      if (i?.properties)
        for (const d of i.properties)
          d.name && l.push(d.name);
    } catch (c) {
      ne(`[useItemProperties] Error getting ModelProperties for ${s}:`, c);
    }
  if (s && l.length > 0) {
    const c = n.length > 0 ? n[0].seedLocalId ?? e : e, i = n.length > 0 ? n[0].seedUid ?? t : t;
    for (const d of l)
      if (!a.has(d))
        try {
          const u = se.create(
            {
              propertyName: d,
              modelName: s,
              seedLocalId: c || void 0,
              seedUid: i || void 0,
              propertyValue: null
            },
            { waitForReady: !1 }
          );
          u && o.push(u);
        } catch (u) {
          ye(`[useItemProperties] Error creating ItemProperty for missing property ${d}:`, u);
        }
  }
  if (e || t) {
    const c = await r.select({ createdAt: A.createdAt }).from(A).where(t ? U(A.uid, t) : U(A.localId, e)).limit(1);
    if (c.length > 0 && c[0].createdAt) {
      const i = "createdAt";
      if (!o.some((u) => u.propertyName === i) && s)
        try {
          const u = n.length > 0 ? n[0].seedLocalId ?? e : e, f = n.length > 0 ? n[0].seedUid ?? t : t, g = se.create(
            {
              propertyName: i,
              modelName: s,
              seedLocalId: u || void 0,
              seedUid: f || void 0,
              propertyValue: c[0].createdAt.toString()
            },
            { waitForReady: !1 }
          );
          g && o.push(g);
        } catch (u) {
          ye("[useItemProperties] Error creating createdAt ItemProperty:", u);
        }
    }
  }
  return o;
}
function mr(e) {
  const t = q(), r = X(), n = D(void 0), o = F(() => typeof e == "string" ? { type: "itemId", itemId: e } : typeof e == "object" ? {
    type: "identifiers",
    seedLocalId: e.seedLocalId,
    seedUid: e.seedUid
  } : null, [e]), a = F(() => {
    if (o)
      return o.type === "itemId" ? o.itemId : o.seedLocalId;
  }, [o]), s = F(() => {
    if (!(!o || o.type === "itemId"))
      return o.seedUid;
  }, [o]), l = a ?? s ?? "", c = F(
    () => ["seed", "itemProperties", l],
    [l]
  ), {
    data: i = [],
    isLoading: d,
    error: u
  } = Z({
    queryKey: c,
    queryFn: () => St(a, s),
    enabled: t && !!l
  }), f = F(() => {
    if (!t || !a && !s)
      return ne("[useItemProperties] Query: returning null (not ready or no identifiers)"), null;
    const b = W.getAppDb();
    if (!b)
      return ne("[useItemProperties] Query: returning null (no db)"), null;
    ne(`[useItemProperties] Query: creating query for seedLocalId=${a}, seedUid=${s}`);
    const y = s ? b.select({
      propertyName: T.propertyName,
      propertyValue: T.propertyValue,
      seedLocalId: T.seedLocalId,
      seedUid: T.seedUid,
      modelType: T.modelType,
      schemaUid: T.schemaUid,
      createdAt: T.createdAt,
      attestationCreatedAt: T.attestationCreatedAt
    }).from(T).where(
      Le(
        U(T.seedUid, s),
        Ee(T.propertyName)
      )
    ) : a ? b.select({
      propertyName: T.propertyName,
      propertyValue: T.propertyValue,
      seedLocalId: T.seedLocalId,
      seedUid: T.seedUid,
      modelType: T.modelType,
      schemaUid: T.schemaUid,
      createdAt: T.createdAt,
      attestationCreatedAt: T.attestationCreatedAt
    }).from(T).where(
      Le(
        U(T.seedLocalId, a),
        Ee(T.propertyName)
      )
    ) : null;
    return ne("[useItemProperties] Query: created query object", { queryType: s ? "seedUid" : "seedLocalId" }), y;
  }, [t, a, s]), g = ie(f), v = F(() => {
    if (!g || g.length === 0)
      return [];
    const b = /* @__PURE__ */ new Map();
    for (const y of g) {
      if (!y.propertyName) continue;
      const p = b.get(y.propertyName);
      if (!p)
        b.set(y.propertyName, y);
      else {
        const E = p.attestationCreatedAt || p.createdAt || 0;
        (y.attestationCreatedAt || y.createdAt || 0) > E && b.set(y.propertyName, y);
      }
    }
    return Array.from(b.values());
  }, [g]);
  return I(() => {
    if (!t || !a && !s || v === void 0) return;
    const b = JSON.stringify(
      v.map((y) => ({
        propertyName: y.propertyName,
        propertyValue: y.propertyValue,
        seedLocalId: y.seedLocalId,
        seedUid: y.seedUid
      })).sort((y, p) => (y.propertyName || "").localeCompare(p.propertyName || ""))
    );
    n.current !== b && (n.current = b, v.length > 0 && r.invalidateQueries({ queryKey: c }));
  }, [t, v, i, a, s, r, c]), I(() => {
    n.current = void 0;
  }, [a, s]), {
    properties: i,
    isLoading: d,
    error: u
  };
}
const hr = () => {
  const e = D(void 0), [t, r] = S(!1), [n, o] = S(null), a = x(() => o(null), []), s = x((l) => {
    if (!l.propertyName || !l.seedLocalId && !l.seedUid || !l.modelName) {
      const d = new Error("seedLocalId or seedUid, propertyName, and modelName are required");
      o(d);
      return;
    }
    o(null), r(!0), e.current?.unsubscribe(), e.current = void 0;
    const c = se.create(l, { waitForReady: !1 });
    if (!c) {
      o(new Error("Failed to create item property")), r(!1);
      return;
    }
    const i = c.getService().subscribe((d) => {
      if (d?.value === "error") {
        const u = d.context?._loadingError?.error ?? new Error("Failed to create item property");
        o(u instanceof Error ? u : new Error(String(u))), r(!1);
      }
      d?.value === "idle" && (o(null), r(!1));
    });
    return e.current = i, c;
  }, []);
  return I(() => () => {
    e.current?.unsubscribe(), e.current = void 0;
  }, []), {
    create: s,
    isLoading: t,
    error: n,
    resetError: a
  };
}, gr = () => {
  const [e, t] = S(null), [r, n] = S({
    isLoading: !1,
    error: null
  });
  I(() => {
    if (!e) {
      n({ isLoading: !1, error: null });
      return;
    }
    const s = e.getService(), l = () => {
      const d = s.getSnapshot().context;
      n({
        isLoading: !!d._destroyInProgress,
        error: d._destroyError ? new Error(d._destroyError.message) : null
      });
    };
    l();
    const c = s.subscribe(l);
    return () => c.unsubscribe();
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
}, xe = G("seedSdk:react:services"), wt = ["idle", "ready", "done", "success", "initialized"], Ke = (e) => {
  let t = "actor";
  const r = e;
  return e && r.uniqueKey && (t = r.uniqueKey), e && !r.uniqueKey && r.logic && r.logic.config && (t = De(e)), t;
}, Me = (e) => {
  let t;
  return e && e.getSnapshot() && e.getSnapshot().value && (t = e.getSnapshot().value), Ke(e) === "global" && t && typeof t == "object" && Object.keys(t).length > 0 && Object.keys(t)[0] === "initialized" && (t = "ready"), t && typeof t == "object" && (t = JSON.stringify(t)), t;
}, De = (e) => {
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
    return xe("Error:", a), n;
  }
  if (o) {
    const a = o.context;
    a && a.dbName && (n = a.dbName), a && a.modelNamePlural && (n = a.modelNamePlural), a && a.modelName && (n = gt(a.modelName.toLowerCase()));
  }
  return n;
}, br = (e) => {
  const [t, r] = S(0), n = (s) => {
    let l = 0;
    const c = s;
    if (c.logic?.states) {
      const i = [], d = [];
      for (const [g, v] of Object.entries(c.logic.states))
        v.tags?.includes("loading") && (i.push(g), d.push(v));
      const u = d.length, f = Me(s);
      if (f && wt.includes(f))
        return 0;
      f && (l = i.indexOf(f) / u * 100);
    }
    return l;
  }, o = x(
    (s) => {
      e.getSnapshot().context;
      const l = e.getSnapshot().value;
      if (l === "done" || l === "success" || l === "idle" || l === "ready") {
        clearInterval(s);
        return;
      }
      r((c) => c + 1);
    },
    [e]
  ), a = x(() => {
    const s = setInterval(() => {
      o(s);
    }, 1e3);
    return s;
  }, [o, e]);
  return I(() => {
    const s = a();
    return () => clearInterval(s);
  }, []), {
    name: Ke(e),
    timeElapsed: t,
    value: Me(e),
    percentComplete: n(e),
    uniqueKey: De(e)
  };
}, It = () => {
  const [e, t] = S(!1), { internalStatus: r } = xt();
  return I(() => {
    r === "ready" && t(!0);
  }, [r]), I(() => {
    r === "ready" && t(!0);
  }, []), e;
}, vr = () => {
  const [e, t] = S(!1), r = Et(), { services: n, percentComplete: o } = Lt(), a = x(async () => {
    for (const l of n) {
      const c = De(l);
      xe(
        `would save to db with snapshot__${c}:`,
        JSON.stringify(l.getPersistedSnapshot())
      );
    }
  }, [n]), s = x(async () => {
    const l = W.getAppDb();
    return l ? await l.select().from(ue).where(qe(ue.key, "snapshot__%")) : [];
  }, []);
  I(() => !r || e ? void 0 : ((async () => {
    const c = await s();
    xe("persistedSnapshots:", c), t(!0);
  })(), () => {
    a();
  }), [r, e]);
}, Et = () => {
  const [e, t] = S(!1), r = It();
  return I(() => {
    r && (async () => {
      const a = await W.getAppDb().select().from(ue).where(qe(ue.key, "snapshot__%"));
      a && a.length > 0 && t(!0);
    })();
  }, [r]), e;
}, Lt = () => {
  const [e, t] = S([]), [r, n] = S(5);
  return I(() => {
    const a = me().getService(), s = a;
    s.uniqueKey = "clientManager", t([s]);
    const l = a.subscribe((c) => {
      const i = c.value;
      let d = 0;
      i === C.IDLE ? d = 100 : i === C.ADD_MODELS_TO_DB ? d = 90 : i === C.ADD_MODELS_TO_STORE ? d = 80 : i === C.PROCESS_SCHEMA_FILES ? d = 70 : i === C.SAVE_CONFIG ? d = 60 : i === C.DB_INIT ? d = 50 : i === C.FILE_SYSTEM_INIT ? d = 30 : i === C.PLATFORM_CLASSES_INIT && (d = 10), n(d);
    });
    return () => {
      l.unsubscribe();
    };
  }, []), {
    services: e,
    percentComplete: r
  };
}, xt = () => {
  const t = me().getService(), r = Ie(t, (o) => o.value), n = Ie(t, (o) => {
    const a = o.value;
    return a === C.DB_INIT || a === C.SAVE_CONFIG || a === C.PROCESS_SCHEMA_FILES || a === C.ADD_MODELS_TO_STORE || a === C.ADD_MODELS_TO_DB || a === C.IDLE ? "ready" : a;
  });
  return {
    status: r,
    internalStatus: n
  };
};
G("seedSdk:react:db");
const Sr = () => {
  const [e, t] = S(!1), r = x(() => {
    e || t(!0);
  }, []);
  return I(() => {
    let n;
    return (async () => {
      const s = me().getService(), l = s.getSnapshot().value;
      if (l === C.DB_INIT || l === C.SAVE_CONFIG || l === C.PROCESS_SCHEMA_FILES || l === C.ADD_MODELS_TO_STORE || l === C.ADD_MODELS_TO_DB || l === C.IDLE) {
        r();
        return;
      }
      n = s.subscribe((c) => {
        const i = c.value;
        (i === C.DB_INIT || i === C.SAVE_CONFIG || i === C.PROCESS_SCHEMA_FILES || i === C.ADD_MODELS_TO_STORE || i === C.ADD_MODELS_TO_DB || i === C.IDLE) && (r(), n?.unsubscribe());
      });
    })(), () => {
      n && n.unsubscribe();
    };
  }, []), {
    dbsAreReady: e
  };
}, je = G("seedSdk:react:schema"), Nt = (e) => {
  const [t, r] = S(null), [n, o] = S(!!e), [a, s] = S(null), l = D(null), c = q(), i = x((d) => {
    o(!0), s(null);
    try {
      const u = he.create(d, {
        waitForReady: !1
      });
      r(u);
      const f = u.getService();
      f.getSnapshot().value === "idle" ? (de(() => o(!1)), s(null)) : o(!0), l.current = f.subscribe((b) => {
        b.value === "idle" ? (de(() => o(!1)), s(null)) : o(!0);
      });
    } catch (u) {
      return je("[useSchema] Error creating schema:", u), s(u), r(null), o(!1), null;
    }
  }, []);
  return I(() => {
    if (l.current && (l.current.unsubscribe(), l.current = null), !c) {
      r(null), s(null), o(!1);
      return;
    }
    if (!e) {
      r(null), s(null), o(!1);
      return;
    }
    return i(e), () => {
      l.current && (l.current.unsubscribe(), l.current = null);
    };
  }, [e, c, i]), {
    schema: t,
    isLoading: n,
    error: a
  };
}, ve = ["seed", "schemas"], wr = () => {
  const e = q(), t = X(), r = D(void 0), n = D([]), {
    data: o = [],
    isLoading: a,
    error: s
  } = Z({
    queryKey: ve,
    queryFn: () => he.all({ waitForReady: !0 }),
    enabled: e
  });
  n.current = o;
  const l = e ? W.getAppDb() : null, c = F(() => l ? l.select().from(Y).orderBy(Y.name, pt(Y.version)) : null, [l, e]), i = ie(c);
  return I(() => {
    if (typeof BroadcastChannel > "u") return;
    const d = new BroadcastChannel("seed-schemas-invalidate"), u = () => {
      t.invalidateQueries({ queryKey: ve });
    };
    return d.addEventListener("message", u), () => {
      d.removeEventListener("message", u), d.close();
    };
  }, [t]), I(() => {
    if (!e || !i)
      return;
    const d = r.current, u = d ? JSON.stringify(d) : "undefined", f = i ? JSON.stringify(i) : "undefined";
    if (u === f && d !== void 0)
      return;
    r.current = i;
    const g = /* @__PURE__ */ new Set();
    for (const p of n.current) {
      const E = p.id || p.schemaFileId;
      if (E)
        g.add(E);
      else {
        const w = p.metadata?.name, m = p.version;
        w && m !== void 0 && g.add(`${w}:${m}`);
      }
    }
    const v = /* @__PURE__ */ new Set();
    for (const p of i)
      p.name !== "Seed Protocol" && (p.schemaFileId ? v.add(p.schemaFileId) : p.name != null && p.version !== void 0 && v.add(`${p.name}:${p.version}`));
    const b = g.size === v.size && [...g].every((p) => v.has(p)), y = g.size > 0 && v.size > 0 && [...v].some((p) => !g.has(p));
    !b && y && t.invalidateQueries({ queryKey: ve });
  }, [e, i, t]), {
    schemas: o,
    isLoading: a,
    error: s
  };
}, Ir = () => {
  const e = D(null), [t, r] = S(!1), [n, o] = S(null), a = x(() => o(null), []), s = x((l) => {
    o(null), r(!0), e.current?.unsubscribe(), e.current = null;
    const c = he.create(l, {
      waitForReady: !1
    }), i = c.getService().subscribe((d) => {
      if (d.value === "error") {
        const u = d.context._loadingError?.error;
        o(u instanceof Error ? u : new Error("Failed to create schema")), r(!1);
      }
      d.value === "idle" && (o(null), r(!1));
    });
    return e.current = i, c;
  }, []);
  return I(() => () => {
    e.current?.unsubscribe(), e.current = null;
  }, []), {
    createSchema: s,
    isLoading: t,
    error: n,
    resetError: a
  };
}, Er = () => {
  const [e, t] = S(null), [r, n] = S({
    isLoading: !1,
    error: null
  });
  I(() => {
    if (!e) {
      n({ isLoading: !1, error: null });
      return;
    }
    const s = e.getService(), l = () => {
      const d = s.getSnapshot().context;
      n({
        isLoading: !!d._destroyInProgress,
        error: d._destroyError ? new Error(d._destroyError.message) : null
      });
    };
    l();
    const c = s.subscribe(l);
    return () => c.unsubscribe();
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
}, Lr = () => {
  const [e, t] = S(), r = D(/* @__PURE__ */ new Map()), n = q(), o = x(async () => {
    if (n)
      try {
        const a = await st(), s = /* @__PURE__ */ new Set();
        for (const c of a) {
          const i = c.schema.metadata?.name;
          i && s.add(i);
        }
        const l = /* @__PURE__ */ new Map();
        for (const c of s)
          if (r.current.has(c)) {
            const i = r.current.get(c);
            l.set(c, i);
          } else {
            const i = he.create(c, {
              waitForReady: !1
            });
            l.set(c, i);
          }
        for (const [c, i] of r.current.entries())
          s.has(c) || i.unload();
        r.current = l, t(Array.from(l.values()));
      } catch (a) {
        je("Error fetching all schema versions from database:", a), t(null);
      }
  }, [n]);
  return I(() => {
    n && o();
  }, [n, o]), I(() => () => {
    r.current.forEach((a) => {
      a.unload();
    }), r.current.clear();
  }, []), e;
}, xr = () => Nt(ot), At = (e) => ["seed", "models", e], Te = /* @__PURE__ */ new Map(), Ft = (e) => {
  const t = q(), r = X(), n = D([]), o = F(() => At(e), [e]), {
    data: a = [],
    isLoading: s,
    error: l
  } = Z({
    queryKey: o,
    queryFn: async () => {
      const y = r.getQueryData(o), p = await oe.all(e, { waitForReady: !1 });
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
  }), c = e && typeof e == "string" ? e : "";
  a.length > 0 && Te.set(c, a);
  const i = n.current.length > 0 ? n.current : Te.get(c), d = e ? a.length > 0 ? a : i?.length ? i : a : a;
  n.current = d, I(() => {
    if (!e || typeof BroadcastChannel > "u") return;
    const y = new BroadcastChannel("seed-models-invalidate"), p = (E) => {
      const { schemaName: w, schemaFileId: m } = E.data || {};
      (e === w || e === m) && (r.invalidateQueries({ queryKey: o }), r.refetchQueries({ queryKey: o }));
    };
    return y.addEventListener("message", p), () => {
      y.removeEventListener("message", p), y.close();
    };
  }, [e, r, o]);
  const u = D(null), f = D(null);
  function g() {
    const y = W.getAppDb();
    return !y || !e ? null : y.select({
      modelFileId: ae.schemaFileId,
      modelName: ae.name
    }).from(Y).innerJoin(be, U(Y.id, be.schemaId)).innerJoin(ae, U(be.modelId, ae.id)).where(
      te(
        U(Y.schemaFileId, e),
        U(Y.name, e)
      )
    );
  }
  const v = F(() => {
    if (!e || !t) return null;
    const y = { schemaId: e, ready: t }, p = u.current;
    if (p && p.schemaId === y.schemaId && p.ready === y.ready && f.current !== null)
      return f.current;
    const E = g();
    return E ? (u.current = y, f.current = E, E) : null;
  }, [e, t]), b = ie(v);
  return I(() => {
    if (!t || !b || !e) return;
    const y = /* @__PURE__ */ new Set();
    for (const m of n.current) {
      const P = m.id || m.modelFileId;
      P ? y.add(P) : m.modelName && y.add(m.modelName);
    }
    const p = /* @__PURE__ */ new Set();
    for (const m of b)
      m.modelFileId ? p.add(m.modelFileId) : m.modelName && p.add(m.modelName);
    const E = y.size === p.size && [...y].every((m) => p.has(m)), w = p.size > 0 && [...p].some((m) => !y.has(m));
    !E && w && r.invalidateQueries({ queryKey: o });
  }, [t, b, e, r, o]), {
    models: d,
    isLoading: s,
    error: l
  };
}, _t = (e, t) => {
  const r = q(), [n, o] = S(void 0), [a, s] = S(!1), [l, c] = S(null), i = D(void 0), [, d] = S(0), u = t == null;
  if (F(() => r ? u ? !!e : !!(e && t) : !1, [r, u, e, t]), I(() => {
    if (!r || !u || !e) {
      o(void 0), s(!1), c(null);
      return;
    }
    (async () => {
      try {
        s(!0), c(null);
        const p = await oe.createById(e);
        o(p || void 0), s(!1), c(null);
      } catch (p) {
        console.error("[useModel] Error looking up model by ID:", p), o(void 0), s(!1), c(p);
      }
    })();
  }, [r, u, e]), I(() => {
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
      error: l
    };
  const { models: f, isLoading: g, error: v } = Ft(e), b = F(() => {
    if (t)
      return f.find((y) => (y.modelName ?? y.name) === t);
  }, [f, t]);
  return I(() => {
    if (u || !b) {
      i.current?.unsubscribe(), i.current = void 0;
      return;
    }
    i.current?.unsubscribe();
    const y = b.getService().subscribe((p) => {
      d((E) => E + 1);
    });
    return i.current = y, () => {
      i.current?.unsubscribe(), i.current = void 0;
    };
  }, [u, b]), {
    model: b,
    isLoading: g,
    error: v
  };
}, Nr = () => {
  const e = D(void 0), [t, r] = S(!1), [n, o] = S(null), a = x(() => o(null), []), s = x(
    (l, c, i) => {
      o(null), r(!0), e.current?.unsubscribe(), e.current = void 0;
      const d = oe.create(c, l, {
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
  return I(() => () => {
    e.current?.unsubscribe(), e.current = void 0;
  }, []), {
    create: s,
    isLoading: t,
    error: n,
    resetError: a
  };
}, Ar = () => {
  const [e, t] = S(null), [r, n] = S({
    isLoading: !1,
    error: null
  });
  I(() => {
    if (!e) {
      n({ isLoading: !1, error: null });
      return;
    }
    const s = e.getService(), l = () => {
      const d = s.getSnapshot().context;
      n({
        isLoading: !!d._destroyInProgress,
        error: d._destroyError ? new Error(d._destroyError.message) : null
      });
    };
    l();
    const c = s.subscribe(l);
    return () => c.unsubscribe();
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
const Fr = (e, t) => {
  const { model: r } = _t(e, t);
  F(() => {
    if (r)
      try {
        return r.modelName ?? r.name;
      } catch {
        return;
      }
  }, [r]);
  const n = q(), o = X(), a = F(() => {
    if (!r) return null;
    try {
      return r._getSnapshotContext()._dbId;
    } catch {
      return null;
    }
  }, [r]), s = r?.id, l = F(
    () => ["seed", "modelProperties", s ?? ""],
    [s]
  ), {
    data: c = [],
    isLoading: i,
    error: d
  } = Z({
    queryKey: l,
    queryFn: () => fe.all(s, { waitForReady: !0 }),
    enabled: n && !!s
  }), u = n ? W.getAppDb() : null, f = F(() => !u || !a ? null : u.select({
    id: ee.id,
    name: ee.name,
    dataType: ee.dataType,
    schemaFileId: ee.schemaFileId
  }).from(ee).where(U(ee.modelId, a)), [u, n, a]), g = ie(f), v = D([]);
  v.current = c, I(() => {
    if (!s || c.length > 0 || !o || !l) return;
    const p = [400, 1200, 2500].map(
      (E) => setTimeout(() => {
        o.invalidateQueries({ queryKey: l });
      }, E)
    );
    return () => p.forEach((E) => clearTimeout(E));
  }, [s, c.length, o, l]), I(() => {
    if (!n || !r?.id || !g || !l) return;
    const y = /* @__PURE__ */ new Set();
    for (const m of v.current) {
      const H = m._getSnapshotContext()?.id;
      H ? y.add(H) : m.name && y.add(m.name);
    }
    const p = /* @__PURE__ */ new Set();
    for (const m of g)
      m.schemaFileId ? p.add(m.schemaFileId) : m.name && p.add(m.name);
    !(y.size === p.size && (y.size === 0 || [...y].every((m) => p.has(m)))) && (y.size > 0 || p.size > 0) && o.invalidateQueries({ queryKey: l });
  }, [n, g, r?.id, o, l]);
  const b = i && c.length === 0;
  return {
    modelProperties: c,
    isLoading: b,
    error: d
  };
}, Dt = async (e, t) => {
  const r = await oe.createById(e);
  if (!r)
    return;
  const n = r.modelName ?? r.name;
  if (n)
    return Ue(n, t);
};
function _r(e, t, r) {
  const n = F(() => r != null ? !!(e && t && r) : t != null ? !!(e && t) : !!e, [e, t, r]), [o, a] = S(void 0), [s, l] = S(n), [c, i] = S(null), d = D(void 0), u = q(), f = F(() => r != null ? { type: "schemaId", schemaId: e, modelName: t, propertyName: r } : t != null ? { type: "modelFileId", modelFileId: e, propertyName: t } : { type: "propertyFileId", propertyFileId: e }, [e, t, r]), g = F(() => u ? f.type === "propertyFileId" ? !!f.propertyFileId : f.type === "modelFileId" ? !!(f.modelFileId && f.propertyName) : !!(f.schemaId && f.modelName && f.propertyName) : !1, [u, f]), v = x(async () => {
    if (!u) {
      a(void 0), l(!1), i(null);
      return;
    }
    let y, p;
    try {
      if (l(!0), i(null), f.type === "propertyFileId") {
        if (!f.propertyFileId) {
          a(void 0), l(!1), i(null);
          return;
        }
        const E = await fe.createById(f.propertyFileId);
        E ? (a(E), l(!1), i(null)) : (a(void 0), l(!1), i(null));
        return;
      } else if (f.type === "modelFileId") {
        if (!f.modelFileId || !f.propertyName) {
          a(void 0), l(!1), i(null);
          return;
        }
        y = await Dt(f.modelFileId, f.propertyName);
        const E = await oe.createById(f.modelFileId);
        p = E?.modelName ?? E?.name;
      } else {
        if (!f.schemaId || !f.modelName || !f.propertyName) {
          a(void 0), l(!1), i(null);
          return;
        }
        y = await Ue(f.modelName, f.propertyName), p = f.modelName;
      }
      if (y && p) {
        const E = fe.create(
          { ...y, modelName: p },
          { waitForReady: !1 }
        ), w = E instanceof Promise ? await E : E;
        de(() => {
          a(w), l(!1), i(null);
        });
      } else
        a(void 0), l(!1), i(null);
    } catch (E) {
      console.error("[useModelProperty] Error updating model property:", E), a(void 0), l(!1), i(E);
    }
  }, [u, f.type, f.propertyFileId, f.modelFileId, f.propertyName, f.schemaId, f.modelName]);
  I(() => {
    if (!g) {
      a(void 0), l(!1), i(null);
      return;
    }
    v();
  }, [g, v]);
  const b = f.type === "propertyFileId";
  return I(() => {
    if (!o || !b)
      return;
    d.current?.unsubscribe();
    const y = ze(v, 100), p = o.getService().subscribe(() => {
      y();
    });
    return d.current = p, () => {
      y.cancel(), d.current?.unsubscribe(), d.current = void 0;
    };
  }, [o, v, b]), {
    modelProperty: o,
    isLoading: s,
    error: c
  };
}
const Dr = () => {
  const e = D(void 0), [t, r] = S(!1), [n, o] = S(null), a = x(() => o(null), []), s = x(
    (l, c, i) => {
      if (o(null), r(!0), e.current?.unsubscribe(), e.current = void 0, !c || !i.name || !i.dataType) {
        const g = new Error("modelName, property name and dataType are required");
        throw o(g), r(!1), g;
      }
      const d = it(l) ?? l, u = fe.create(
        { ...i, modelName: c },
        { waitForReady: !1, schemaName: d }
      ), f = u.getService().subscribe((g) => {
        if (g.value === "error") {
          const v = g.context._loadingError?.error ?? new Error("Failed to create model property");
          o(v instanceof Error ? v : new Error(String(v))), r(!1);
        }
        g.value === "idle" && (o(null), r(!1));
      });
      return e.current = f, u;
    },
    []
  );
  return I(() => () => {
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
  I(() => {
    if (!e) {
      n({ isLoading: !1, error: null });
      return;
    }
    const s = e.getService(), l = () => {
      const d = s.getSnapshot().context;
      n({
        isLoading: !!d._destroyInProgress,
        error: d._destroyError ? new Error(d._destroyError.message) : null
      });
    };
    l();
    const c = s.subscribe(l);
    return () => c.unsubscribe();
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
}, Rr = () => {
  const [e, t] = S(null), [r, n] = S({
    isLoading: !1,
    error: null
  });
  I(() => {
    if (!e) {
      n({ isLoading: !1, error: null });
      return;
    }
    const s = e.getService(), l = () => {
      const d = s.getSnapshot().context;
      n({
        isLoading: !!d._destroyInProgress,
        error: d._destroyError ? new Error(d._destroyError.message) : null
      });
    };
    l();
    const c = s.subscribe(l);
    return () => c.unsubscribe();
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
}, Se = ["seed", "imageFiles"];
function Pr() {
  const e = q(), t = X(), {
    data: r = [],
    isLoading: n,
    error: o,
    refetch: a
  } = Z({
    queryKey: Se,
    queryFn: () => j.listImageFiles(),
    enabled: e
  });
  return I(() => {
    const s = (c) => {
      c.includes("/images/") && t.invalidateQueries({ queryKey: Se });
    }, l = () => {
      t.invalidateQueries({ queryKey: Se });
    };
    return K.on("file-saved", s), K.on("fs.downloadAll.success", l), () => {
      K.off("file-saved", s), K.off("fs.downloadAll.success", l);
    };
  }, [t]), {
    imageFiles: r,
    isLoading: n,
    error: o instanceof Error ? o : null,
    refetch: a
  };
}
const Ct = ["seed", "files"];
function Mr(e = "files") {
  const t = q(), r = X(), n = F(() => [...Ct, e], [e]), {
    data: o = [],
    isLoading: a,
    error: s,
    refetch: l
  } = Z({
    queryKey: n,
    queryFn: () => j.listFiles(e),
    enabled: t
  });
  return I(() => {
    const c = (d) => {
      d.includes(`/${e}/`) && r.invalidateQueries({ queryKey: n });
    }, i = () => {
      r.invalidateQueries({ queryKey: n });
    };
    return K.on("file-saved", c), K.on("fs.downloadAll.success", i), () => {
      K.off("file-saved", c), K.off("fs.downloadAll.success", i);
    };
  }, [r, e, n]), {
    files: o,
    isLoading: a,
    error: s instanceof Error ? s : null,
    refetch: l
  };
}
const Rt = {
  queries: {
    networkMode: "offlineFirst",
    gcTime: 1e3 * 60 * 60 * 24,
    // 24 hours
    staleTime: 1e3 * 60
    // 1 minute - list data can be slightly stale
  }
};
function We() {
  return { ...Rt };
}
function Pt(e) {
  const t = We();
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
function Mt(e) {
  const t = We(), { defaultOptions: r, ...n } = e ?? {};
  return new mt({
    ...n,
    defaultOptions: r ? Pt(r) : t
  });
}
let Ne = null;
function Tr(e) {
  const t = Ne?.(e);
  return typeof window < "u" && window.__SEED_INVALIDATE_ITEM_PROPERTIES__ && window.__SEED_INVALIDATE_ITEM_PROPERTIES__(e), Promise.resolve(t).then(() => {
  });
}
function Tt({ queryClient: e }) {
  return I(() => {
    const t = (n) => {
      const o = ["seed", "itemProperties", n];
      return e.invalidateQueries({ queryKey: o }), e.refetchQueries({ queryKey: o });
    };
    Ne = t, typeof window < "u" && (window.__SEED_INVALIDATE_ITEM_PROPERTIES__ = t);
    const r = (n) => {
      const o = n?.seedLocalId ?? n?.seedUid;
      o && t(o);
    };
    return K.on("itemProperty.saved", r), () => {
      K.off("itemProperty.saved", r), Ne = null, typeof window < "u" && (window.__SEED_INVALIDATE_ITEM_PROPERTIES__ = null);
    };
  }, [e]), null;
}
function kr({ children: e, queryClient: t, queryClientRef: r }) {
  const n = F(
    () => t ?? Mt(),
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
  return /* @__PURE__ */ h(ht, { client: n, children: /* @__PURE__ */ O(bt, { queryClient: n, children: [
    /* @__PURE__ */ h(Tt, { queryClient: n }),
    e
  ] }) });
}
function kt() {
  return /* @__PURE__ */ h(
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
function $r({
  initConfig: e,
  schema: t,
  loadingComponent: r,
  wrapperClassName: n,
  loadingClassName: o,
  children: a
}) {
  const s = q();
  I(() => {
    const u = t ? {
      ...e,
      config: {
        ...e.config,
        schema: t
      }
    } : e;
    at.init(u);
  }, [e, t]);
  const l = r ?? /* @__PURE__ */ h(kt, {}), c = n ? void 0 : { position: "relative", display: "flex", height: "100vh", width: "100vw" }, i = {
    display: s ? "none" : "flex",
    ...!o && {
      position: "absolute",
      inset: 0,
      zIndex: 50,
      alignItems: "center",
      justifyContent: "center"
    }
  };
  return /* @__PURE__ */ O("div", { className: n, style: c, children: [
    /* @__PURE__ */ h(
      "div",
      {
        className: o,
        style: i,
        "aria-hidden": s,
        children: l
      }
    ),
    /* @__PURE__ */ h("div", { style: {
      flex: 1,
      display: s ? "flex" : "none",
      flexDirection: "column"
    }, children: a })
  ] });
}
async function Je(e, t = "") {
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
        const s = await Je(o, a);
        r.push(...s);
      }
    }
  } catch (n) {
    console.warn(`Failed to scan directory ${t}:`, n);
  }
  return r;
}
function $t(e = {}) {
  const { rootPath: t } = e, [r, n] = S([]), [o, a] = S(!0), [s, l] = S(null), c = x(async () => {
    a(!0), l(null);
    try {
      let d = await navigator.storage.getDirectory();
      if (t) {
        const f = t.split("/").filter(Boolean);
        for (const g of f)
          d = await d.getDirectoryHandle(g);
      }
      const u = await Je(d, t || "");
      n(u.sort((f, g) => f.path.localeCompare(g.path)));
    } catch (i) {
      l(
        "Failed to access OPFS: " + (i instanceof Error ? i.message : String(i))
      ), console.error("OPFS access error:", i);
    } finally {
      a(!1);
    }
  }, [t]);
  return I(() => {
    c();
  }, [c]), { files: r, isLoading: o, error: s, refetch: c };
}
const ke = () => /* @__PURE__ */ h("svg", { xmlns: "http://www.w3.org/2000/svg", fill: "none", viewBox: "0 0 24 24", strokeWidth: 1.5, stroke: "currentColor", style: { width: 20, height: 20 }, children: /* @__PURE__ */ h("path", { strokeLinecap: "round", strokeLinejoin: "round", d: "M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" }) }), Bt = () => /* @__PURE__ */ h("svg", { xmlns: "http://www.w3.org/2000/svg", fill: "none", viewBox: "0 0 24 24", strokeWidth: 1.5, stroke: "currentColor", style: { width: 48, height: 48 }, children: /* @__PURE__ */ h("path", { strokeLinecap: "round", strokeLinejoin: "round", d: "M2.25 12.75V12a2.25 2.25 0 012.25-2.25h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" }) }), Ot = () => /* @__PURE__ */ h("svg", { xmlns: "http://www.w3.org/2000/svg", fill: "none", viewBox: "0 0 24 24", strokeWidth: 1.5, stroke: "currentColor", style: { width: 20, height: 20 }, children: /* @__PURE__ */ h("path", { strokeLinecap: "round", strokeLinejoin: "round", d: "M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" }) }), $e = () => /* @__PURE__ */ h("svg", { xmlns: "http://www.w3.org/2000/svg", fill: "none", viewBox: "0 0 24 24", strokeWidth: 1.5, stroke: "currentColor", style: { width: 20, height: 20 }, children: /* @__PURE__ */ h("path", { strokeLinecap: "round", strokeLinejoin: "round", d: "M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" }) }), Ut = () => /* @__PURE__ */ O(
  "svg",
  {
    xmlns: "http://www.w3.org/2000/svg",
    fill: "none",
    viewBox: "0 0 24 24",
    style: { width: 32, height: 32 },
    "aria-hidden": !0,
    children: [
      /* @__PURE__ */ h(
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
      /* @__PURE__ */ h(
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
function zt(e) {
  if (e === 0) return "0 Bytes";
  const t = 1024, r = ["Bytes", "KB", "MB", "GB"], n = Math.floor(Math.log(e) / Math.log(t));
  return Math.round(e / Math.pow(t, n) * 100) / 100 + " " + r[n];
}
function qt(e) {
  return new Date(e).toLocaleString();
}
async function Ht(e, t) {
  const r = e.path.split("/").filter(Boolean);
  if (r.length === 0) throw new Error("Invalid file path");
  let n = t;
  for (let l = 0; l < r.length - 1; l++)
    n = await n.getDirectoryHandle(r[l]);
  const o = r[r.length - 1];
  return await (await n.getFileHandle(o)).getFile();
}
async function Be(e, t) {
  const r = e.split("/").filter(Boolean);
  if (r.length === 0) throw new Error("Invalid file path");
  let n = t;
  for (let a = 0; a < r.length - 1; a++)
    n = await n.getDirectoryHandle(r[a]);
  const o = r[r.length - 1];
  await n.removeEntry(o);
}
const Qt = {
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
}, R = {
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
function Br({
  rootPath: e,
  filter: t,
  onBeforeDelete: r,
  onAfterDelete: n,
  onDownload: o,
  title: a = "Files",
  description: s = "Browse and download all files stored in the Origin Private File System (OPFS).",
  theme: l = "dark",
  className: c
}) {
  const i = Qt[l], { files: d, isLoading: u, error: f, refetch: g } = $t({ rootPath: e }), v = t ? d.filter(t) : d, [b, y] = S(/* @__PURE__ */ new Set()), p = D(null), E = v.length > 0 && b.size === v.length, w = b.size > 0 && b.size < v.length, m = (L) => {
    y((k) => {
      const _ = new Set(k);
      return _.has(L) ? _.delete(L) : _.add(L), _;
    });
  }, P = () => {
    y(
      b.size === v.length ? /* @__PURE__ */ new Set() : new Set(v.map((L) => L.path))
    );
  };
  I(() => {
    y(/* @__PURE__ */ new Set());
  }, [v.length]), I(() => {
    p.current && (p.current.indeterminate = w);
  }, [w]);
  const H = async (L, k = !1) => {
    try {
      const _ = await navigator.storage.getDirectory(), z = await Ht(L, _);
      if (o)
        await o(L, z);
      else {
        const V = URL.createObjectURL(z), M = document.createElement("a");
        M.href = V, M.download = L.name, document.body.appendChild(M), M.click(), document.body.removeChild(M), URL.revokeObjectURL(V);
      }
    } catch (_) {
      const z = "Failed to download file: " + (_ instanceof Error ? _.message : String(_));
      throw k || alert(z), _;
    }
  }, N = async (L) => {
    if (!(r && !await r(L)) && confirm(`Are you sure you want to delete "${L.name}"? This action cannot be undone.`))
      try {
        const k = await navigator.storage.getDirectory();
        await Be(L.path, k), await g(), await n?.([L.path]);
      } catch (k) {
        alert("Failed to delete file: " + (k instanceof Error ? k.message : String(k)));
      }
  }, $ = async () => {
    if (b.size === 0) return;
    const L = v.filter((_) => b.has(_.path)), k = [];
    for (const _ of L)
      try {
        await H(_, !0), await new Promise((z) => setTimeout(z, 100));
      } catch (z) {
        k.push(`${_.name}: ${z instanceof Error ? z.message : String(z)}`);
      }
    k.length > 0 && alert(`Some downloads failed:
${k.join(`
`)}`);
  }, Q = async () => {
    if (b.size === 0) return;
    const L = v.filter((M) => b.has(M.path)), k = L.map((M) => M.name).join(", ");
    if (!confirm(
      `Are you sure you want to delete ${b.size} file(s)?

Files: ${k}

This action cannot be undone.`
    ))
      return;
    const _ = await navigator.storage.getDirectory(), z = [], V = [];
    for (const M of L)
      if (!(r && !await r(M)))
        try {
          await Be(M.path, _), z.push(M.path);
        } catch (J) {
          V.push(`${M.name}: ${J instanceof Error ? J.message : String(J)}`);
        }
    y(/* @__PURE__ */ new Set()), await g(), z.length > 0 && await n?.(z), V.length > 0 && alert(`Some deletions failed:
${V.join(`
`)}`);
  };
  return /* @__PURE__ */ O("div", { className: c, style: R.container, children: [
    /* @__PURE__ */ h("style", { children: "@keyframes opfs-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}" }),
    /* @__PURE__ */ O("div", { style: R.header, children: [
      /* @__PURE__ */ O("div", { style: { flex: 1, minWidth: 0 }, children: [
        /* @__PURE__ */ h("h1", { style: R.title, className: i.title, children: a }),
        /* @__PURE__ */ h("p", { style: R.description, className: i.description, children: s })
      ] }),
      /* @__PURE__ */ h("button", { type: "button", onClick: g, className: R.button, children: "Refresh" })
    ] }),
    b.size > 0 && /* @__PURE__ */ O(
      "div",
      {
        className: `mt-4 flex items-center justify-between rounded-lg border px-4 py-3 ${i.batchBar}`,
        children: [
          /* @__PURE__ */ O("span", { className: `text-sm font-medium ${i.batchText}`, children: [
            b.size,
            " file",
            b.size === 1 ? "" : "s",
            " selected"
          ] }),
          /* @__PURE__ */ O("div", { className: "flex items-center gap-3", children: [
            /* @__PURE__ */ h("button", { onClick: $, className: R.button, children: /* @__PURE__ */ O("span", { className: "inline-flex items-center gap-2", children: [
              /* @__PURE__ */ h(ke, {}),
              " Download All"
            ] }) }),
            /* @__PURE__ */ h("button", { onClick: Q, className: R.buttonDanger, children: /* @__PURE__ */ O("span", { className: "inline-flex items-center gap-2", children: [
              /* @__PURE__ */ h($e, {}),
              " Delete All"
            ] }) }),
            /* @__PURE__ */ h(
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
    /* @__PURE__ */ h("div", { className: "mt-8", children: u ? /* @__PURE__ */ O("div", { className: "flex justify-center items-center py-12 gap-3", children: [
      /* @__PURE__ */ h("span", { style: { animation: "opfs-spin 1s linear infinite" }, children: /* @__PURE__ */ h(Ut, {}) }),
      /* @__PURE__ */ h("span", { className: i.loadingText, children: "Loading files..." })
    ] }) : f ? /* @__PURE__ */ O("div", { className: `${R.errorBox} ${i.errorBox}`, children: [
      /* @__PURE__ */ h("h3", { className: `m-0 text-sm font-medium ${i.errorTitle}`, children: "Error" }),
      /* @__PURE__ */ h("div", { className: `mt-2 text-sm ${i.errorText}`, children: f })
    ] }) : v.length === 0 ? /* @__PURE__ */ O("div", { className: R.emptyState, children: [
      /* @__PURE__ */ h("span", { className: i.emptyIcon, children: /* @__PURE__ */ h(Bt, {}) }),
      /* @__PURE__ */ h("h3", { className: `mt-2 text-sm font-semibold ${i.emptyTitle}`, children: "No files" }),
      /* @__PURE__ */ h("p", { className: `mt-1 text-sm ${i.emptyText}`, children: "No files found in OPFS." })
    ] }) : /* @__PURE__ */ h("div", { className: "overflow-x-auto", children: /* @__PURE__ */ O("table", { className: R.table, children: [
      /* @__PURE__ */ h("thead", { children: /* @__PURE__ */ O("tr", { className: i.tableBorder, children: [
        /* @__PURE__ */ h("th", { className: `${R.tableHeader} w-10 ${i.tableHeader}`, children: /* @__PURE__ */ h(
          "input",
          {
            ref: p,
            type: "checkbox",
            checked: E,
            onChange: P,
            "aria-label": "Select all"
          }
        ) }),
        /* @__PURE__ */ h("th", { className: `${R.tableHeader} ${i.tableHeader}`, children: "Name" }),
        /* @__PURE__ */ h("th", { className: `${R.tableHeader} ${i.tableHeader}`, children: "Path" }),
        /* @__PURE__ */ h("th", { className: `${R.tableHeader} ${i.tableHeader}`, children: "Size" }),
        /* @__PURE__ */ h("th", { className: `${R.tableHeader} ${i.tableHeader}`, children: "Type" }),
        /* @__PURE__ */ h("th", { className: `${R.tableHeader} ${i.tableHeader}`, children: "Modified" }),
        /* @__PURE__ */ h(
          "th",
          {
            className: `${R.tableHeader} w-24 ${i.tableHeader}`,
            "aria-label": "Actions"
          }
        )
      ] }) }),
      /* @__PURE__ */ h("tbody", { className: `divide-y ${i.tableBorder}`, children: v.map((L) => /* @__PURE__ */ O("tr", { className: i.tableRow, children: [
        /* @__PURE__ */ h("td", { className: `${R.tableCell} ${i.tableCell}`, children: /* @__PURE__ */ h(
          "input",
          {
            type: "checkbox",
            checked: b.has(L.path),
            onChange: () => m(L.path),
            "aria-label": `Select ${L.name}`
          }
        ) }),
        /* @__PURE__ */ h("td", { className: `${R.tableCell} ${i.tableCell}`, children: /* @__PURE__ */ O("span", { className: "flex items-center gap-2", children: [
          /* @__PURE__ */ h(Ot, {}),
          L.name
        ] }) }),
        /* @__PURE__ */ h("td", { className: `${R.tableCell} ${i.tableCellMuted}`, children: /* @__PURE__ */ h("code", { className: `text-xs px-2 py-1 rounded border ${i.codeBlock}`, children: L.path }) }),
        /* @__PURE__ */ h("td", { className: `${R.tableCell} ${i.tableCellMuted}`, children: zt(L.size) }),
        /* @__PURE__ */ h("td", { className: `${R.tableCell} ${i.tableCellMuted}`, children: L.type }),
        /* @__PURE__ */ h("td", { className: `${R.tableCell} ${i.tableCellMuted}`, children: qt(L.lastModified) }),
        /* @__PURE__ */ h("td", { className: R.tableCell, children: /* @__PURE__ */ O("div", { className: "flex gap-2 justify-end", children: [
          /* @__PURE__ */ h(
            "button",
            {
              type: "button",
              onClick: () => H(L),
              title: "Download",
              className: `p-1.5 rounded cursor-pointer bg-transparent border-0 transition-colors ${i.actionButton}`,
              children: /* @__PURE__ */ h(ke, {})
            }
          ),
          /* @__PURE__ */ h(
            "button",
            {
              type: "button",
              onClick: () => N(L),
              title: "Delete",
              className: `p-1.5 rounded cursor-pointer bg-transparent border-0 transition-colors ${i.deleteButton}`,
              children: /* @__PURE__ */ h($e, {})
            }
          )
        ] }) })
      ] }, L.path)) })
    ] }) }) })
  ] });
}
const we = G("seedSdk:react:SeedImage"), ce = /* @__PURE__ */ new Map(), Ge = (e) => {
  const t = /^(.*[\/\\])?([^\/\\]+?)(\.[^.\/\\]*)?$/, r = e.match(t);
  return r && r[2] ? r[2] : e;
};
function Vt(e) {
  return e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function Kt(e, t) {
  const r = new RegExp(`^${Vt(t)}$`), n = Ge(e);
  return r.test(n);
}
const jt = ({ imageProperty: e, width: t, filename: r, ...n }) => {
  const [o, a] = S(), [s, l] = S(), { property: c } = Ve({
    propertyName: e.propertyName,
    seedLocalId: e.seedLocalId,
    seedUid: e.seedUid
  }), i = e ?? c, d = r ?? i?.refResolvedValue ?? i?.value, u = i?.value, f = typeof u == "string" ? u : d, g = u != null && (u instanceof File || u instanceof Blob), [v, b] = S(null), y = Oe.useRef(null);
  I(() => {
    if (g && (u instanceof File || u instanceof Blob))
      return y.current || (y.current = URL.createObjectURL(u), b(y.current)), () => {
        y.current && (URL.revokeObjectURL(y.current), y.current = null), b(null);
      };
    y.current = null, b(null);
  }, [g, u]), I(() => {
    if (!d || u && ((N) => typeof N == "string" && N.startsWith("blob:"))(u) || v) return;
    let P = !1;
    return (async () => {
      try {
        const N = i?.localStoragePath ? i.localStoragePath : `${j.getFilesPath("images")}/${d}`;
        if (await j.pathExists(N)) {
          const Q = await j.getContentUrlFromPath(N);
          !P && Q && l(Q);
        }
      } catch (N) {
        we("_getOriginalContentUrl error", N);
      }
    })(), () => {
      P = !0;
    };
  }, [d, u, v, i?.localStoragePath]), I(() => {
    if (!t || !d)
      return;
    (async () => {
      try {
        const P = await j.getFs(), H = i?.localStoragePath ? i.localStoragePath.split("/").slice(0, -1).join("/") : j.getFilesPath("images"), Q = P.readdirSync(H, { withFileTypes: !0 }).filter((B) => B.isDirectory()).map((B) => parseInt(B.name)), L = Q.reduce((B, re) => Math.abs(re - t) < Math.abs(B - t) ? re : B, Q[0]), k = Ge(d), _ = `${k}-${L}`;
        if (ce.has(_))
          try {
            const B = ce.get(_);
            if (B && (await fetch(B)).ok) {
              a(B);
              return;
            }
          } catch (B) {
            we("error", B), ce.delete(_);
          }
        const V = P.readdirSync(`${H}/${L}`, { withFileTypes: !0 }).find((B) => B.name ? Kt(B.name, k) : !1);
        if (!V)
          return;
        const M = `${H}/${L}/${V?.name}`;
        if (await j.pathExists(M)) {
          const B = await j.getContentUrlFromPath(M);
          B && (ce.set(_, B), a(B));
        }
      } catch (P) {
        we("_getSizedContentUrl error", P);
      }
    })();
  }, [i, t, f, d]);
  const p = (m) => typeof m == "string" && m.startsWith("blob:");
  if (!(!!o || !!s || !!v || !!f && p(f)) && !d)
    return null;
  const w = o || s || v || (p(f) ? f : void 0) || "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
  return /* @__PURE__ */ h("img", { src: w, alt: n.alt || e.propertyName || "Image", ...n });
}, Or = Oe.memo(
  jt,
  (e, t) => e.imageProperty === t.imageProperty && e.width === t.width && e.filename === t.filename
);
function Ye(e) {
  const { value: t, enabled: r = !0, treatAs: n } = e, [o, a] = S(0), [s, l] = S(null), [c, i] = S(null), [d, u] = S("idle");
  I(() => {
    let b = !1;
    return (async () => {
      if (!r || t == null || String(t).trim() === "") {
        b || (l(null), i(null), u("idle"));
        return;
      }
      b || (u("loading"), i(null));
      try {
        const p = await lt(String(t), { treatAs: n });
        if (b) return;
        l(p), p.status === "empty" ? u("empty") : p.status === "ready" ? u("ready") : u("unresolved");
      } catch (p) {
        if (b) return;
        i(p instanceof Error ? p : new Error(String(p))), l(null), u("error");
      }
    })(), () => {
      b = !0;
    };
  }, [r, t, n, o]);
  const f = x(() => {
    a((b) => b + 1);
  }, []), g = s && s.status === "ready" ? s.href : void 0, v = s && s.status === "ready" ? s.source : void 0;
  return {
    href: g,
    status: d,
    source: v,
    error: c,
    result: s,
    refetch: f
  };
}
function Ur({
  value: e,
  enabled: t,
  treatAs: r,
  render: n,
  alt: o,
  ...a
}) {
  const { href: s } = Ye({ value: e, enabled: t, treatAs: r });
  if (!s)
    return null;
  const l = { ...a, src: s, alt: o ?? "" };
  return n ? /* @__PURE__ */ h(ge, { children: n(l) }) : /* @__PURE__ */ h("img", { ...l });
}
function Wt(e) {
  try {
    return new URL(e).pathname.split("/").filter(Boolean).pop() || "Open";
  } catch {
    return "Open";
  }
}
function Jt(e) {
  try {
    const t = new URL(e).protocol;
    return t === "http:" || t === "https:";
  } catch {
    return !1;
  }
}
function zr({
  value: e,
  enabled: t,
  treatAs: r,
  download: n,
  render: o,
  children: a,
  target: s,
  rel: l,
  ...c
}) {
  const { href: i } = Ye({ value: e, enabled: t, treatAs: r });
  if (!i)
    return null;
  const d = Jt(i), u = s !== void 0 ? s : d ? "_blank" : void 0, f = {
    ...c,
    href: i,
    download: n,
    target: u,
    rel: l ?? (d && u === "_blank" ? "noopener noreferrer" : void 0),
    children: a ?? Wt(i)
  };
  return o ? /* @__PURE__ */ h(ge, { children: o(f) }) : /* @__PURE__ */ h("a", { ...f });
}
function Gt(e) {
  return typeof e == "string" && e.trim().length > 0;
}
function qr({
  html: e,
  sanitize: t,
  render: r,
  ...n
}) {
  if (!Gt(e))
    return null;
  const o = t(e);
  return r ? /* @__PURE__ */ h(ge, { children: r({ html: o }) }) : /* @__PURE__ */ h("div", { ...n, dangerouslySetInnerHTML: { __html: o } });
}
function Ae(e, t) {
  return e.length <= t ? e : `${e.slice(0, t)}…`;
}
function Yt(e) {
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
    return Ae(e, r);
  if (e === null || typeof e != "object")
    return e;
  if (o.has(e))
    return "[Circular]";
  if (n >= t)
    return "[Max depth]";
  if (o.add(e), Array.isArray(e))
    return e.map((s) => Fe(s, t, r, n + 1, o));
  const a = {};
  for (const [s, l] of Object.entries(e))
    a[s] = Fe(l, t, r, n + 1, o);
  return a;
}
function Xt(e, t) {
  const r = t?.maxDepth ?? 6, n = t?.maxStringLength ?? 5e4, o = t?.space ?? 2;
  if (e === void 0)
    return "undefined";
  if (e === null)
    return "null";
  let a = e;
  if (typeof e == "string")
    if (Yt(e))
      try {
        a = JSON.parse(e);
      } catch {
        return Ae(e, n);
      }
    else
      return Ae(e, n);
  const s = Fe(a, r, n, 0, /* @__PURE__ */ new WeakSet());
  try {
    return JSON.stringify(s, null, o);
  } catch {
    return "[Unserializable JSON]";
  }
}
function Hr({
  value: e,
  format: t,
  formatOptions: r,
  render: n,
  ...o
}) {
  const a = t ? t(e) : Xt(e, r);
  return n ? /* @__PURE__ */ h(ge, { children: n({ text: a }) }) : /* @__PURE__ */ h("pre", { ...o, children: a });
}
function Qr(e, t) {
  return F(() => e ? ct(e, t) : {}, [e, t]);
}
export {
  Pe as ADDRESSES_PERSISTED_EVENT,
  Ct as FILES_QUERY_KEY_PREFIX,
  Br as OPFSFilesManager,
  $r as SeedClientGate,
  qr as SeedHtml,
  Or as SeedImage,
  Hr as SeedJson,
  zr as SeedMediaFile,
  Ur as SeedMediaImage,
  kr as SeedProvider,
  Mt as createSeedQueryClient,
  Xt as formatSeedJson,
  We as getSeedQueryDefaultOptions,
  Ke as getServiceName,
  De as getServiceUniqueKey,
  Me as getServiceValue,
  Tr as invalidateItemPropertiesForItem,
  Pt as mergeSeedQueryDefaults,
  Lr as useAllSchemaVersions,
  fr as useCreateItem,
  hr as useCreateItemProperty,
  Nr as useCreateModel,
  Dr as useCreateModelProperty,
  Ir as useCreateSchema,
  Sr as useDbsAreReady,
  yr as useDebouncedItemProperty,
  Rr as useDeleteItem,
  gr as useDestroyItemProperty,
  Ar as useDestroyModel,
  Cr as useDestroyModelProperty,
  Er as useDestroySchema,
  Mr as useFiles,
  xt as useGlobalServiceStatus,
  Et as useHasSavedSnapshots,
  Pr as useImageFiles,
  It as useIsDbReady,
  dr as useItem,
  mr as useItemProperties,
  Ve as useItemProperty,
  ur as useItems,
  ie as useLiveQuery,
  _t as useModel,
  Fr as useModelProperties,
  _r as useModelProperty,
  Ft as useModels,
  Qr as useNormalizedFeedItemFields,
  $t as useOPFSFiles,
  vr as usePersistedSnapshots,
  pr as usePublishItem,
  Ye as useResolvedMediaRef,
  Nt as useSchema,
  wr as useSchemas,
  Qe as useSeedAddressRevision,
  xr as useSeedProtocolSchema,
  br as useService,
  Lt as useServices
};
//# sourceMappingURL=index.js.map
