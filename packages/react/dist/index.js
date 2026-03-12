import { useState as S, useRef as D, useMemo as L, useEffect as E, useCallback as h } from "react";
import { flushSync as Y } from "react-dom";
import { getClient as ee, ClientManagerState as w, BaseDb as q, Item as ue, seeds as F, getVersionData as he, createNewItem as _e, ItemProperty as z, metadata as N, appState as G, Schema as re, schemas as O, loadAllSchemasFromDb as we, SEED_PROTOCOL_SCHEMA_NAME as Le, Model as V, models as H, modelSchemas as te, ModelProperty as W, properties as k, getPropertySchema as be, getSchemaNameFromId as De, BaseFileManager as ve, eventEmitter as T } from "@seedprotocol/sdk";
import { orderBy as Fe, startCase as fe, debounce as Ne } from "lodash-es";
import Q from "debug";
import { useSelector as oe } from "@xstate/react";
import { or as J, isNull as ye, eq as A, isNotNull as ie, and as ce, gt as Ae, like as Se, desc as Pe } from "drizzle-orm";
import { useQueryClient as x, useQuery as U, QueryClient as Re, QueryClientProvider as Ce } from "@tanstack/react-query";
import Me from "pluralize";
import { jsxs as Te, jsx as qe } from "react/jsx-runtime";
const P = () => {
  const t = ee().getService();
  return oe(t, (s) => s.value === w.IDLE);
};
function j(e) {
  const [t, r] = S(void 0), s = D(null), o = D(void 0), l = P(), n = L(() => {
    if (!l || !e)
      return null;
    try {
      return q.liveQuery(e);
    } catch (a) {
      return console.error("[useLiveQuery] Failed to create live query:", a), null;
    }
  }, [e, l]);
  return E(() => {
    if (s.current && (s.current.unsubscribe(), s.current = null), !n)
      return;
    const a = n.subscribe({
      next: (i) => {
        const c = o.current, u = c ? JSON.stringify(c) : "undefined", p = i ? JSON.stringify(i) : "undefined";
        u === p && c !== void 0 || (o.current = i, r(i));
      },
      error: (i) => {
        console.error("[useLiveQuery] Error:", i);
      }
    });
    return s.current = a, () => {
      s.current && (s.current.unsubscribe(), s.current = null);
    };
  }, [n]), t;
}
const X = Q("seedSdk:react:item"), lr = ({ modelName: e, seedLocalId: t, seedUid: r }) => {
  const [s, o] = S(), [l, n] = S(!!(t || r)), [a, i] = S(null), c = D(void 0), u = D(!1), p = P(), y = D(e), b = D(t), g = D(r), I = L(() => p ? !!(b.current || g.current) : !1, [p, t, r]), d = h(async () => {
    if (!!!(p && (b.current || g.current))) {
      o(void 0), n(!1), i(null);
      return;
    }
    try {
      i(null);
      const v = await ue.find({
        modelName: y.current,
        seedLocalId: b.current,
        seedUid: g.current
      });
      if (!v) {
        X("[useItem] [loadItem] no item found", y.current, b.current), o((_) => _ && (_.seedLocalId && _.seedLocalId === b.current || _.seedUid && _.seedUid === g.current) ? _ : void 0), n(!1), i(null);
        return;
      }
      o(v), n(!1), i(null);
    } catch (v) {
      X("[useItem] Error loading item:", v), o(void 0), n(!1), i(v);
    }
  }, [p]);
  return E(() => {
    y.current = e, b.current = t, g.current = r;
  }, [e, t, r]), E(() => {
    if (!I) {
      !t && !r && (o(void 0), n(!1), i(null));
      return;
    }
    d();
  }, [I, d, t, r]), E(() => {
    if (!s) {
      c.current?.unsubscribe(), c.current = void 0, u.current = !1;
      return;
    }
    c.current?.unsubscribe(), u.current = !1;
    const v = s.getService().subscribe((_) => {
      _ && typeof _ == "object" && "value" in _ && (_.value === "idle" ? (u.current = !0, n(!1), i(null)) : _.value === "error" ? (i(new Error("Item service error")), n(!1)) : u.current && n(!0));
    });
    return c.current = v, () => {
      c.current?.unsubscribe(), c.current = void 0;
    };
  }, [s]), {
    item: s,
    isLoading: l,
    error: a
  };
}, Oe = (e, t, r, s) => ["seed", "items", e ?? null, t ?? !1, r ?? !1, s ?? null], ur = ({
  modelName: e,
  deleted: t = !1,
  includeEas: r = !1,
  addressFilter: s
}) => {
  const o = P(), l = x(), n = D(void 0), a = D([]), i = D(/* @__PURE__ */ new Set()), c = L(
    () => Oe(e, t, r, s),
    [e, t, r, s]
  ), {
    data: u = [],
    isLoading: p,
    error: y
  } = U({
    queryKey: c,
    queryFn: () => ue.all(e, t, { waitForReady: !0, includeEas: r, addressFilter: s }),
    enabled: o
  });
  a.current = u;
  const b = o ? q.getAppDb() : null, g = L(() => {
    if (!b) return null;
    const d = [];
    r || d.push(J(ye(F.uid), A(F.uid, ""))), e && d.push(A(F.type, e.toLowerCase())), t ? d.push(
      J(
        ie(F._markedForDeletion),
        A(F._markedForDeletion, 1)
      )
    ) : d.push(
      J(
        ye(F._markedForDeletion),
        A(F._markedForDeletion, 0)
      )
    );
    const f = he();
    return b.with(f).select({
      localId: F.localId,
      uid: F.uid,
      type: F.type,
      schemaUid: F.schemaUid,
      createdAt: F.createdAt,
      attestationCreatedAt: F.attestationCreatedAt,
      _markedForDeletion: F._markedForDeletion
    }).from(F).leftJoin(f, A(F.localId, f.seedLocalId)).where(ce(Ae(f.versionsCount, 0), ...d)).groupBy(F.localId);
  }, [b, o, e, t, r]), I = j(g);
  return E(() => {
    if (!o || !I) return;
    const d = /* @__PURE__ */ new Set();
    for (const m of I) {
      const R = m.localId || m.uid;
      R && d.add(R);
    }
    const f = /* @__PURE__ */ new Set();
    for (const m of a.current) {
      const R = m.seedLocalId || m.seedUid;
      R && f.add(R);
    }
    if (d.size === 0 && f.size > 0) return;
    const v = i.current;
    if (v.size === d.size && [...v].every((m) => d.has(m)))
      return;
    if (n.current = I, f.size === d.size && [...f].every((m) => d.has(m))) {
      i.current = new Set(d);
      return;
    }
    i.current = new Set(d), l.invalidateQueries({ queryKey: c });
  }, [o, I, l, c]), {
    items: Fe(
      u,
      [
        (d) => d.lastVersionPublishedAt || d.attestationCreatedAt || d.createdAt
      ],
      ["desc"]
    ),
    isLoading: p,
    error: y
  };
}, dr = () => {
  const [e, t] = S(!1), [r, s] = S(null), o = h(() => s(null), []);
  return {
    createItem: h(
      async (n, a) => {
        if (e) {
          X("[useCreateItem] [createItem] already creating item, skipping");
          return;
        }
        s(null), Y(() => t(!0));
        try {
          const i = a ?? {}, { seedLocalId: c } = await _e({ modelName: n, ...i });
          return await ue.find({ modelName: n, seedLocalId: c }) ?? void 0;
        } catch (i) {
          X("[useCreateItem] Error creating item:", i), s(i instanceof Error ? i : new Error(String(i)));
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
}, fr = () => {
  const [e, t] = S(null), [r, s] = S(!1), [o, l] = S(null), n = D(void 0), a = h(() => l(null), []), i = h((c) => {
    c && (t(c), l(null), c.publish().catch(() => {
    }));
  }, []);
  return E(() => {
    if (!e) {
      n.current?.unsubscribe(), n.current = void 0, s(!1);
      return;
    }
    n.current?.unsubscribe();
    const c = e.getService(), u = c.subscribe((g) => {
      const I = g?.value, d = g?.context;
      s(I === "publishing");
      const f = d?._publishError;
      l(f ? new Error(f.message) : null);
    });
    n.current = u;
    const p = c.getSnapshot();
    s(p?.value === "publishing");
    const b = p?.context?._publishError;
    return l(b ? new Error(b.message) : null), () => {
      n.current?.unsubscribe(), n.current = void 0;
    };
  }, [e]), {
    publishItem: i,
    isLoading: r,
    error: o,
    resetError: a
  };
}, Z = Q("seedSdk:react:property"), B = Q("seedSdk:react:itemProperties");
function yr(e, t) {
  const r = P(), [s, o] = S(void 0), [l, n] = S(!1), [a, i] = S(null), c = D(void 0), [, u] = S(0), y = typeof e == "object" && e != null ? e : null, b = y?.itemId, g = y?.seedLocalId, I = y?.seedUid, d = y?.propertyName, f = typeof e == "string" ? e : b !== void 0 && b !== "" ? b : void 0, _ = d ?? (typeof e == "string" ? t : void 0), m = L(() => {
    const C = f !== void 0 && f !== "" ? f : g, M = f !== void 0 && f !== "" ? void 0 : I;
    return (C != null || M != null) && _ != null && _ !== "" ? {
      type: "identifiers",
      seedLocalId: C ?? void 0,
      seedUid: M,
      propertyName: _
    } : null;
  }, [f, _, g, I]);
  L(() => m ? !!((m.seedLocalId || m.seedUid) && m.propertyName) : !1, [m]);
  const R = L(() => !r || !m ? !1 : !!((m.seedLocalId || m.seedUid) && m.propertyName), [r, m]), K = h(async () => {
    if (!r || !m) {
      o(void 0), n(!1), i(null);
      return;
    }
    try {
      n(!0), i(null);
      const C = m.seedLocalId, M = m.seedUid;
      if (!C && !M) {
        o(void 0), n(!1), i(null);
        return;
      }
      const $ = await z.find({
        propertyName: m.propertyName,
        seedLocalId: C,
        seedUid: M
      });
      if (!$) {
        Z(
          `[useItemProperty] [updateItemProperty] no property found for Item.${C || M}.${m.propertyName}`
        ), o(void 0), n(!1), i(null);
        return;
      }
      o($), n(!1), i(null);
    } catch (C) {
      Z("[useItemProperty] Error updating item property:", C), o(void 0), n(!1), i(C);
    }
  }, [r, m]);
  return E(() => {
    if (!R) {
      o(void 0), n(!1), i(null);
      return;
    }
    s && m && s.propertyName === m.propertyName && (m.seedLocalId != null && s.seedLocalId === m.seedLocalId || m.seedUid != null && s.seedUid === m.seedUid) || K();
  }, [R, K, s, m]), E(() => {
    if (!s) {
      c.current?.unsubscribe(), c.current = void 0;
      return;
    }
    c.current?.unsubscribe();
    const C = s.getService().subscribe((M) => {
      M && typeof M == "object" && "value" in M && M.value === "idle" && (n(!1), i(null)), u(($) => $ + 1);
    });
    return c.current = C, () => {
      c.current?.unsubscribe(), c.current = void 0;
    };
  }, [s]), {
    property: s,
    isLoading: l,
    error: a
  };
}
async function Qe(e, t) {
  if (!e && !t) return [];
  const r = q.getAppDb();
  if (!r) return [];
  const s = await z.all(
    { seedLocalId: e ?? void 0, seedUid: t ?? void 0 },
    { waitForReady: !0 }
  ), o = [...s], l = /* @__PURE__ */ new Set();
  for (const i of s)
    i.propertyName && l.add(i.propertyName);
  let n;
  if (s.length > 0) {
    const i = s[0];
    n = i.modelName ?? i.modelType, n && typeof n == "string" && (n = fe(n));
  }
  if (!n) {
    const i = await r.select({ type: F.type }).from(F).where(t ? A(F.uid, t) : A(F.localId, e)).limit(1);
    i.length > 0 && i[0].type && (n = fe(i[0].type));
  }
  const a = [];
  if (n)
    try {
      const { Model: i } = await import("@seedprotocol/sdk"), c = await i.getByNameAsync(n);
      if (c?.properties)
        for (const u of c.properties)
          u.name && a.push(u.name);
    } catch (i) {
      B(`[useItemProperties] Error getting ModelProperties for ${n}:`, i);
    }
  if (n && a.length > 0) {
    const i = s.length > 0 ? s[0].seedLocalId ?? e : e, c = s.length > 0 ? s[0].seedUid ?? t : t;
    for (const u of a)
      if (!l.has(u))
        try {
          const p = z.create(
            {
              propertyName: u,
              modelName: n,
              seedLocalId: i || void 0,
              seedUid: c || void 0,
              propertyValue: null
            },
            { waitForReady: !1 }
          );
          p && o.push(p);
        } catch (p) {
          Z(`[useItemProperties] Error creating ItemProperty for missing property ${u}:`, p);
        }
  }
  if (e || t) {
    const i = await r.select({ createdAt: F.createdAt }).from(F).where(t ? A(F.uid, t) : A(F.localId, e)).limit(1);
    if (i.length > 0 && i[0].createdAt) {
      const c = "createdAt";
      if (!o.some((p) => p.propertyName === c) && n)
        try {
          const p = s.length > 0 ? s[0].seedLocalId ?? e : e, y = s.length > 0 ? s[0].seedUid ?? t : t, b = z.create(
            {
              propertyName: c,
              modelName: n,
              seedLocalId: p || void 0,
              seedUid: y || void 0,
              propertyValue: i[0].createdAt.toString()
            },
            { waitForReady: !1 }
          );
          b && o.push(b);
        } catch (p) {
          Z("[useItemProperties] Error creating createdAt ItemProperty:", p);
        }
    }
  }
  return o;
}
function pr(e) {
  const t = P(), r = x(), s = D(void 0), o = L(() => typeof e == "string" ? { type: "itemId", itemId: e } : typeof e == "object" ? {
    type: "identifiers",
    seedLocalId: e.seedLocalId,
    seedUid: e.seedUid
  } : null, [e]), l = L(() => {
    if (o)
      return o.type === "itemId" ? o.itemId : o.seedLocalId;
  }, [o]), n = L(() => {
    if (!(!o || o.type === "itemId"))
      return o.seedUid;
  }, [o]), a = l ?? n ?? "", i = L(
    () => ["seed", "itemProperties", a],
    [a]
  ), {
    data: c = [],
    isLoading: u,
    error: p
  } = U({
    queryKey: i,
    queryFn: () => Qe(l, n),
    enabled: t && !!a
  }), y = L(() => {
    if (!t || !l && !n)
      return B("[useItemProperties] Query: returning null (not ready or no identifiers)"), null;
    const I = q.getAppDb();
    if (!I)
      return B("[useItemProperties] Query: returning null (no db)"), null;
    B(`[useItemProperties] Query: creating query for seedLocalId=${l}, seedUid=${n}`);
    const d = n ? I.select({
      propertyName: N.propertyName,
      propertyValue: N.propertyValue,
      seedLocalId: N.seedLocalId,
      seedUid: N.seedUid,
      modelType: N.modelType,
      schemaUid: N.schemaUid,
      createdAt: N.createdAt,
      attestationCreatedAt: N.attestationCreatedAt
    }).from(N).where(
      ce(
        A(N.seedUid, n),
        ie(N.propertyName)
      )
    ) : l ? I.select({
      propertyName: N.propertyName,
      propertyValue: N.propertyValue,
      seedLocalId: N.seedLocalId,
      seedUid: N.seedUid,
      modelType: N.modelType,
      schemaUid: N.schemaUid,
      createdAt: N.createdAt,
      attestationCreatedAt: N.attestationCreatedAt
    }).from(N).where(
      ce(
        A(N.seedLocalId, l),
        ie(N.propertyName)
      )
    ) : null;
    return B("[useItemProperties] Query: created query object", { queryType: n ? "seedUid" : "seedLocalId" }), d;
  }, [t, l, n]), b = j(y), g = L(() => {
    if (!b || b.length === 0)
      return [];
    const I = /* @__PURE__ */ new Map();
    for (const d of b) {
      if (!d.propertyName) continue;
      const f = I.get(d.propertyName);
      if (!f)
        I.set(d.propertyName, d);
      else {
        const v = f.attestationCreatedAt || f.createdAt || 0;
        (d.attestationCreatedAt || d.createdAt || 0) > v && I.set(d.propertyName, d);
      }
    }
    return Array.from(I.values());
  }, [b]);
  return E(() => {
    if (!t || !l && !n || g === void 0) return;
    const I = JSON.stringify(
      g.map((d) => ({
        propertyName: d.propertyName,
        propertyValue: d.propertyValue,
        seedLocalId: d.seedLocalId,
        seedUid: d.seedUid
      })).sort((d, f) => (d.propertyName || "").localeCompare(f.propertyName || ""))
    );
    s.current !== I && (s.current = I, g.length > 0 && r.invalidateQueries({ queryKey: i }));
  }, [t, g, c, l, n, r, i]), E(() => {
    s.current = void 0;
  }, [l, n]), {
    properties: c,
    isLoading: u,
    error: p
  };
}
const mr = () => {
  const e = D(void 0), [t, r] = S(!1), [s, o] = S(null), l = h(() => o(null), []), n = h((a) => {
    if (!a.propertyName || !a.seedLocalId && !a.seedUid || !a.modelName) {
      const u = new Error("seedLocalId or seedUid, propertyName, and modelName are required");
      o(u);
      return;
    }
    o(null), r(!0), e.current?.unsubscribe(), e.current = void 0;
    const i = z.create(a, { waitForReady: !1 });
    if (!i) {
      o(new Error("Failed to create item property")), r(!1);
      return;
    }
    const c = i.getService().subscribe((u) => {
      if (u?.value === "error") {
        const p = u.context?._loadingError?.error ?? new Error("Failed to create item property");
        o(p instanceof Error ? p : new Error(String(p))), r(!1);
      }
      u?.value === "idle" && (o(null), r(!1));
    });
    return e.current = c, i;
  }, []);
  return E(() => () => {
    e.current?.unsubscribe(), e.current = void 0;
  }, []), {
    create: n,
    isLoading: t,
    error: s,
    resetError: l
  };
}, br = () => {
  const [e, t] = S(null), [r, s] = S({
    isLoading: !1,
    error: null
  });
  E(() => {
    if (!e) {
      s({ isLoading: !1, error: null });
      return;
    }
    const n = e.getService(), a = () => {
      const u = n.getSnapshot().context;
      s({
        isLoading: !!u._destroyInProgress,
        error: u._destroyError ? new Error(u._destroyError.message) : null
      });
    };
    a();
    const i = n.subscribe(a);
    return () => i.unsubscribe();
  }, [e]);
  const o = h(async (n) => {
    n && (t(n), await n.destroy());
  }, []), l = h(() => {
    e && e.getService().send({ type: "clearDestroyError" });
  }, [e]);
  return {
    destroy: o,
    isLoading: r.isLoading,
    error: r.error,
    resetError: l
  };
}, ae = Q("seedSdk:react:services"), xe = ["idle", "ready", "done", "success", "initialized"], ge = (e) => {
  let t = "actor";
  const r = e;
  return e && r.uniqueKey && (t = r.uniqueKey), e && !r.uniqueKey && r.logic && r.logic.config && (t = de(e)), t;
}, pe = (e) => {
  let t;
  return e && e.getSnapshot() && e.getSnapshot().value && (t = e.getSnapshot().value), ge(e) === "global" && t && typeof t == "object" && Object.keys(t).length > 0 && Object.keys(t)[0] === "initialized" && (t = "ready"), t && typeof t == "object" && (t = JSON.stringify(t)), t;
}, de = (e) => {
  const t = e;
  if (!e || !t.logic || !t.logic.config || !t._snapshot)
    return;
  const r = t.logic.config;
  if (!r.id)
    return;
  let s = r.id;
  r.id.includes("@seedSdk/") && (s = r.id.match(/^.*@seedSdk\/(\w+)[\.\w]*/)[1]);
  let o;
  try {
    o = e.getSnapshot();
  } catch (l) {
    return ae("Error:", l), s;
  }
  if (o) {
    const l = o.context;
    l && l.dbName && (s = l.dbName), l && l.modelNamePlural && (s = l.modelNamePlural), l && l.modelName && (s = Me(l.modelName.toLowerCase()));
  }
  return s;
}, vr = (e) => {
  const [t, r] = S(0), s = (n) => {
    let a = 0;
    const i = n;
    if (i.logic?.states) {
      const c = [], u = [];
      for (const [b, g] of Object.entries(i.logic.states))
        g.tags?.includes("loading") && (c.push(b), u.push(g));
      const p = u.length, y = pe(n);
      if (y && xe.includes(y))
        return 0;
      y && (a = c.indexOf(y) / p * 100);
    }
    return a;
  }, o = h(
    (n) => {
      e.getSnapshot().context;
      const a = e.getSnapshot().value;
      if (a === "done" || a === "success" || a === "idle" || a === "ready") {
        clearInterval(n);
        return;
      }
      r((i) => i + 1);
    },
    [e]
  ), l = h(() => {
    const n = setInterval(() => {
      o(n);
    }, 1e3);
    return n;
  }, [o, e]);
  return E(() => {
    const n = l();
    return () => clearInterval(n);
  }, []), {
    name: ge(e),
    timeElapsed: t,
    value: pe(e),
    percentComplete: s(e),
    uniqueKey: de(e)
  };
}, Ue = () => {
  const [e, t] = S(!1), { internalStatus: r } = Be();
  return E(() => {
    r === "ready" && t(!0);
  }, [r]), E(() => {
    r === "ready" && t(!0);
  }, []), e;
}, Sr = () => {
  const [e, t] = S(!1), r = ke(), { services: s, percentComplete: o } = Ke(), l = h(async () => {
    for (const a of s) {
      const i = de(a);
      ae(
        `would save to db with snapshot__${i}:`,
        JSON.stringify(a.getPersistedSnapshot())
      );
    }
  }, [s]), n = h(async () => {
    const a = q.getAppDb();
    return a ? await a.select().from(G).where(Se(G.key, "snapshot__%")) : [];
  }, []);
  E(() => !r || e ? void 0 : ((async () => {
    const i = await n();
    ae("persistedSnapshots:", i), t(!0);
  })(), () => {
    l();
  }), [r, e]);
}, ke = () => {
  const [e, t] = S(!1), r = Ue();
  return E(() => {
    r && (async () => {
      const l = await q.getAppDb().select().from(G).where(Se(G.key, "snapshot__%"));
      l && l.length > 0 && t(!0);
    })();
  }, [r]), e;
}, Ke = () => {
  const [e, t] = S([]), [r, s] = S(5);
  return E(() => {
    const l = ee().getService(), n = l;
    n.uniqueKey = "clientManager", t([n]);
    const a = l.subscribe((i) => {
      const c = i.value;
      let u = 0;
      c === w.IDLE ? u = 100 : c === w.ADD_MODELS_TO_DB ? u = 90 : c === w.ADD_MODELS_TO_STORE ? u = 80 : c === w.PROCESS_SCHEMA_FILES ? u = 70 : c === w.SAVE_CONFIG ? u = 60 : c === w.DB_INIT ? u = 50 : c === w.FILE_SYSTEM_INIT ? u = 30 : c === w.PLATFORM_CLASSES_INIT && (u = 10), s(u);
    });
    return () => {
      a.unsubscribe();
    };
  }, []), {
    services: e,
    percentComplete: r
  };
}, Be = () => {
  const t = ee().getService(), r = oe(t, (o) => o.value), s = oe(t, (o) => {
    const l = o.value;
    return l === w.DB_INIT || l === w.SAVE_CONFIG || l === w.PROCESS_SCHEMA_FILES || l === w.ADD_MODELS_TO_STORE || l === w.ADD_MODELS_TO_DB || l === w.IDLE ? "ready" : l;
  });
  return {
    status: r,
    internalStatus: s
  };
};
Q("seedSdk:react:db");
const gr = () => {
  const [e, t] = S(!1), r = h(() => {
    e || t(!0);
  }, []);
  return E(() => {
    let s;
    return (async () => {
      const n = ee().getService(), a = n.getSnapshot().value;
      if (a === w.DB_INIT || a === w.SAVE_CONFIG || a === w.PROCESS_SCHEMA_FILES || a === w.ADD_MODELS_TO_STORE || a === w.ADD_MODELS_TO_DB || a === w.IDLE) {
        r();
        return;
      }
      s = n.subscribe((i) => {
        const c = i.value;
        (c === w.DB_INIT || c === w.SAVE_CONFIG || c === w.PROCESS_SCHEMA_FILES || c === w.ADD_MODELS_TO_STORE || c === w.ADD_MODELS_TO_DB || c === w.IDLE) && (r(), s?.unsubscribe());
      });
    })(), () => {
      s && s.unsubscribe();
    };
  }, []), {
    dbsAreReady: e
  };
}, Ie = Q("seedSdk:react:schema"), ze = (e) => {
  const [t, r] = S(null), [s, o] = S(!!e), [l, n] = S(null), a = D(null), i = P(), c = h((u) => {
    o(!0), n(null);
    try {
      const p = re.create(u, {
        waitForReady: !1
      });
      r(p);
      const y = p.getService();
      y.getSnapshot().value === "idle" ? (Y(() => o(!1)), n(null)) : o(!0), a.current = y.subscribe((I) => {
        I.value === "idle" ? (Y(() => o(!1)), n(null)) : o(!0);
      });
    } catch (p) {
      return Ie("[useSchema] Error creating schema:", p), n(p), r(null), o(!1), null;
    }
  }, []);
  return E(() => {
    if (a.current && (a.current.unsubscribe(), a.current = null), !i) {
      r(null), n(null), o(!1);
      return;
    }
    if (!e) {
      r(null), n(null), o(!1);
      return;
    }
    return c(e), () => {
      a.current && (a.current.unsubscribe(), a.current = null);
    };
  }, [e, i, c]), {
    schema: t,
    isLoading: s,
    error: l
  };
}, ne = ["seed", "schemas"], Ir = () => {
  const e = P(), t = x(), r = D(void 0), s = D([]), {
    data: o = [],
    isLoading: l,
    error: n
  } = U({
    queryKey: ne,
    queryFn: () => re.all({ waitForReady: !0 }),
    enabled: e
  });
  s.current = o;
  const a = e ? q.getAppDb() : null, i = L(() => a ? a.select().from(O).orderBy(O.name, Pe(O.version)) : null, [a, e]), c = j(i);
  return E(() => {
    if (typeof BroadcastChannel > "u") return;
    const u = new BroadcastChannel("seed-schemas-invalidate"), p = () => {
      t.invalidateQueries({ queryKey: ne });
    };
    return u.addEventListener("message", p), () => {
      u.removeEventListener("message", p), u.close();
    };
  }, [t]), E(() => {
    if (!e || !c)
      return;
    const u = r.current, p = u ? JSON.stringify(u) : "undefined", y = c ? JSON.stringify(c) : "undefined";
    if (p === y && u !== void 0)
      return;
    r.current = c;
    const b = /* @__PURE__ */ new Set();
    for (const f of s.current) {
      const v = f.id || f.schemaFileId;
      if (v)
        b.add(v);
      else {
        const _ = f.metadata?.name, m = f.version;
        _ && m !== void 0 && b.add(`${_}:${m}`);
      }
    }
    const g = /* @__PURE__ */ new Set();
    for (const f of c)
      f.name !== "Seed Protocol" && (f.schemaFileId ? g.add(f.schemaFileId) : f.name != null && f.version !== void 0 && g.add(`${f.name}:${f.version}`));
    const I = b.size === g.size && [...b].every((f) => g.has(f)), d = b.size > 0 && g.size > 0 && [...g].some((f) => !b.has(f));
    !I && d && t.invalidateQueries({ queryKey: ne });
  }, [e, c, t]), {
    schemas: o,
    isLoading: l,
    error: n
  };
}, Er = () => {
  const e = D(null), [t, r] = S(!1), [s, o] = S(null), l = h(() => o(null), []), n = h((a) => {
    o(null), r(!0), e.current?.unsubscribe(), e.current = null;
    const i = re.create(a, {
      waitForReady: !1
    }), c = i.getService().subscribe((u) => {
      if (u.value === "error") {
        const p = u.context._loadingError?.error;
        o(p instanceof Error ? p : new Error("Failed to create schema")), r(!1);
      }
      u.value === "idle" && (o(null), r(!1));
    });
    return e.current = c, i;
  }, []);
  return E(() => () => {
    e.current?.unsubscribe(), e.current = null;
  }, []), {
    createSchema: n,
    isLoading: t,
    error: s,
    resetError: l
  };
}, hr = () => {
  const [e, t] = S(null), [r, s] = S({
    isLoading: !1,
    error: null
  });
  E(() => {
    if (!e) {
      s({ isLoading: !1, error: null });
      return;
    }
    const n = e.getService(), a = () => {
      const u = n.getSnapshot().context;
      s({
        isLoading: !!u._destroyInProgress,
        error: u._destroyError ? new Error(u._destroyError.message) : null
      });
    };
    a();
    const i = n.subscribe(a);
    return () => i.unsubscribe();
  }, [e]);
  const o = h(async (n) => {
    n && (t(n), await n.destroy());
  }, []), l = h(() => {
    e && e.getService().send({ type: "clearDestroyError" });
  }, [e]);
  return {
    destroy: o,
    isLoading: r.isLoading,
    error: r.error,
    resetError: l
  };
}, _r = () => {
  const [e, t] = S(), r = D(/* @__PURE__ */ new Map()), s = P(), o = h(async () => {
    if (s)
      try {
        const l = await we(), n = /* @__PURE__ */ new Set();
        for (const i of l) {
          const c = i.schema.metadata?.name;
          c && n.add(c);
        }
        const a = /* @__PURE__ */ new Map();
        for (const i of n)
          if (r.current.has(i)) {
            const c = r.current.get(i);
            a.set(i, c);
          } else {
            const c = re.create(i, {
              waitForReady: !1
            });
            a.set(i, c);
          }
        for (const [i, c] of r.current.entries())
          n.has(i) || c.unload();
        r.current = a, t(Array.from(a.values()));
      } catch (l) {
        Ie("Error fetching all schema versions from database:", l), t(null);
      }
  }, [s]);
  return E(() => {
    s && o();
  }, [s, o]), E(() => () => {
    r.current.forEach((l) => {
      l.unload();
    }), r.current.clear();
  }, []), e;
}, wr = () => ze(Le), Ve = (e) => ["seed", "models", e], me = /* @__PURE__ */ new Map(), je = (e) => {
  const t = P(), r = x(), s = D([]), o = L(() => Ve(e), [e]), {
    data: l = [],
    isLoading: n,
    error: a
  } = U({
    queryKey: o,
    queryFn: async () => {
      const d = r.getQueryData(o), f = await V.all(e, { waitForReady: !1 });
      if (Array.isArray(d) && d.length > 0 && Array.isArray(f) && f.length === 0)
        return [...d];
      if (Array.isArray(f) && f.length === 0) {
        const v = r.getQueryData(o);
        if (Array.isArray(v) && v.length > 0)
          return [...v];
      }
      return f;
    },
    enabled: t && !!e
  }), i = e && typeof e == "string" ? e : "";
  l.length > 0 && me.set(i, l);
  const c = s.current.length > 0 ? s.current : me.get(i), u = e ? l.length > 0 ? l : c?.length ? c : l : l;
  s.current = u, E(() => {
    if (!e || typeof BroadcastChannel > "u") return;
    const d = new BroadcastChannel("seed-models-invalidate"), f = (v) => {
      const { schemaName: _, schemaFileId: m } = v.data || {};
      (e === _ || e === m) && (r.invalidateQueries({ queryKey: o }), r.refetchQueries({ queryKey: o }));
    };
    return d.addEventListener("message", f), () => {
      d.removeEventListener("message", f), d.close();
    };
  }, [e, r, o]);
  const p = D(null), y = D(null);
  function b() {
    const d = q.getAppDb();
    return !d || !e ? null : d.select({
      modelFileId: H.schemaFileId,
      modelName: H.name
    }).from(O).innerJoin(te, A(O.id, te.schemaId)).innerJoin(H, A(te.modelId, H.id)).where(
      J(
        A(O.schemaFileId, e),
        A(O.name, e)
      )
    );
  }
  const g = L(() => {
    if (!e || !t) return null;
    const d = { schemaId: e, ready: t }, f = p.current;
    if (f && f.schemaId === d.schemaId && f.ready === d.ready && y.current !== null)
      return y.current;
    const v = b();
    return v ? (p.current = d, y.current = v, v) : null;
  }, [e, t]), I = j(g);
  return E(() => {
    if (!t || !I || !e) return;
    const d = /* @__PURE__ */ new Set();
    for (const m of s.current) {
      const R = m.id || m.modelFileId;
      R ? d.add(R) : m.modelName && d.add(m.modelName);
    }
    const f = /* @__PURE__ */ new Set();
    for (const m of I)
      m.modelFileId ? f.add(m.modelFileId) : m.modelName && f.add(m.modelName);
    const v = d.size === f.size && [...d].every((m) => f.has(m)), _ = f.size > 0 && [...f].some((m) => !d.has(m));
    !v && _ && r.invalidateQueries({ queryKey: o });
  }, [t, I, e, r, o]), {
    models: u,
    isLoading: n,
    error: a
  };
}, $e = (e, t) => {
  const r = P(), [s, o] = S(void 0), [l, n] = S(!1), [a, i] = S(null), c = D(void 0), [, u] = S(0), p = t == null;
  if (L(() => r ? p ? !!e : !!(e && t) : !1, [r, p, e, t]), E(() => {
    if (!r || !p || !e) {
      o(void 0), n(!1), i(null);
      return;
    }
    (async () => {
      try {
        n(!0), i(null);
        const f = await V.createById(e);
        o(f || void 0), n(!1), i(null);
      } catch (f) {
        console.error("[useModel] Error looking up model by ID:", f), o(void 0), n(!1), i(f);
      }
    })();
  }, [r, p, e]), E(() => {
    if (!p || !s) {
      c.current?.unsubscribe(), c.current = void 0;
      return;
    }
    c.current?.unsubscribe();
    const d = s.getService().subscribe((f) => {
      u((v) => v + 1);
    });
    return c.current = d, () => {
      c.current?.unsubscribe(), c.current = void 0;
    };
  }, [p, s]), p)
    return {
      model: s,
      isLoading: l,
      error: a
    };
  const { models: y, isLoading: b, error: g } = je(e), I = L(() => {
    if (t)
      return y.find((d) => (d.modelName ?? d.name) === t);
  }, [y, t]);
  return E(() => {
    if (p || !I) {
      c.current?.unsubscribe(), c.current = void 0;
      return;
    }
    c.current?.unsubscribe();
    const d = I.getService().subscribe((f) => {
      u((v) => v + 1);
    });
    return c.current = d, () => {
      c.current?.unsubscribe(), c.current = void 0;
    };
  }, [p, I]), {
    model: I,
    isLoading: b,
    error: g
  };
}, Lr = () => {
  const e = D(void 0), [t, r] = S(!1), [s, o] = S(null), l = h(() => o(null), []), n = h(
    (a, i, c) => {
      o(null), r(!0), e.current?.unsubscribe(), e.current = void 0;
      const u = V.create(i, a, {
        ...c,
        waitForReady: !1
      }), p = u.getService().subscribe((y) => {
        y.value === "error" && (o(
          y.context._loadingError?.error ?? new Error("Failed to create model")
        ), r(!1)), y.value === "idle" && (o(null), r(!1));
      });
      return e.current = p, u;
    },
    []
  );
  return E(() => () => {
    e.current?.unsubscribe(), e.current = void 0;
  }, []), {
    create: n,
    isLoading: t,
    error: s,
    resetError: l
  };
}, Dr = () => {
  const [e, t] = S(null), [r, s] = S({
    isLoading: !1,
    error: null
  });
  E(() => {
    if (!e) {
      s({ isLoading: !1, error: null });
      return;
    }
    const n = e.getService(), a = () => {
      const u = n.getSnapshot().context;
      s({
        isLoading: !!u._destroyInProgress,
        error: u._destroyError ? new Error(u._destroyError.message) : null
      });
    };
    a();
    const i = n.subscribe(a);
    return () => i.unsubscribe();
  }, [e]);
  const o = h(async (n) => {
    n && (t(n), await n.destroy());
  }, []), l = h(() => {
    e && e.getService().send({ type: "clearDestroyError" });
  }, [e]);
  return {
    destroy: o,
    isLoading: r.isLoading,
    error: r.error,
    resetError: l
  };
};
Q("seedSdk:browser:react:modelProperty");
const Fr = (e, t) => {
  const { model: r } = $e(e, t);
  L(() => {
    if (r)
      try {
        return r.modelName ?? r.name;
      } catch {
        return;
      }
  }, [r]);
  const s = P(), o = x(), l = L(() => {
    if (!r) return null;
    try {
      return r._getSnapshotContext()._dbId;
    } catch {
      return null;
    }
  }, [r]), n = r?.id, a = L(
    () => ["seed", "modelProperties", n ?? ""],
    [n]
  ), {
    data: i = [],
    isLoading: c,
    error: u
  } = U({
    queryKey: a,
    queryFn: () => W.all(n, { waitForReady: !0 }),
    enabled: s && !!n
  }), p = s ? q.getAppDb() : null, y = L(() => !p || !l ? null : p.select({
    id: k.id,
    name: k.name,
    dataType: k.dataType,
    schemaFileId: k.schemaFileId
  }).from(k).where(A(k.modelId, l)), [p, s, l]), b = j(y), g = D([]);
  g.current = i, E(() => {
    if (!n || i.length > 0 || !o || !a) return;
    const f = [400, 1200, 2500].map(
      (v) => setTimeout(() => {
        o.invalidateQueries({ queryKey: a });
      }, v)
    );
    return () => f.forEach((v) => clearTimeout(v));
  }, [n, i.length, o, a]), E(() => {
    if (!s || !r?.id || !b || !a) return;
    const d = /* @__PURE__ */ new Set();
    for (const m of g.current) {
      const K = m._getSnapshotContext()?.id;
      K ? d.add(K) : m.name && d.add(m.name);
    }
    const f = /* @__PURE__ */ new Set();
    for (const m of b)
      m.schemaFileId ? f.add(m.schemaFileId) : m.name && f.add(m.name);
    !(d.size === f.size && (d.size === 0 || [...d].every((m) => f.has(m)))) && (d.size > 0 || f.size > 0) && o.invalidateQueries({ queryKey: a });
  }, [s, b, r?.id, o, a]);
  const I = c && i.length === 0;
  return {
    modelProperties: i,
    isLoading: I,
    error: u
  };
}, He = async (e, t) => {
  const r = await V.createById(e);
  if (!r)
    return;
  const s = r.modelName ?? r.name;
  if (s)
    return be(s, t);
};
function Nr(e, t, r) {
  const s = L(() => r != null ? !!(e && t && r) : t != null ? !!(e && t) : !!e, [e, t, r]), [o, l] = S(void 0), [n, a] = S(s), [i, c] = S(null), u = D(void 0), p = P(), y = L(() => r != null ? { type: "schemaId", schemaId: e, modelName: t, propertyName: r } : t != null ? { type: "modelFileId", modelFileId: e, propertyName: t } : { type: "propertyFileId", propertyFileId: e }, [e, t, r]), b = L(() => p ? y.type === "propertyFileId" ? !!y.propertyFileId : y.type === "modelFileId" ? !!(y.modelFileId && y.propertyName) : !!(y.schemaId && y.modelName && y.propertyName) : !1, [p, y]), g = h(async () => {
    if (!p) {
      l(void 0), a(!1), c(null);
      return;
    }
    let d, f;
    try {
      if (a(!0), c(null), y.type === "propertyFileId") {
        if (!y.propertyFileId) {
          l(void 0), a(!1), c(null);
          return;
        }
        const v = await W.createById(y.propertyFileId);
        v ? (l(v), a(!1), c(null)) : (l(void 0), a(!1), c(null));
        return;
      } else if (y.type === "modelFileId") {
        if (!y.modelFileId || !y.propertyName) {
          l(void 0), a(!1), c(null);
          return;
        }
        d = await He(y.modelFileId, y.propertyName);
        const v = await V.createById(y.modelFileId);
        f = v?.modelName ?? v?.name;
      } else {
        if (!y.schemaId || !y.modelName || !y.propertyName) {
          l(void 0), a(!1), c(null);
          return;
        }
        d = await be(y.modelName, y.propertyName), f = y.modelName;
      }
      if (d && f) {
        const v = W.create(
          { ...d, modelName: f },
          { waitForReady: !1 }
        ), _ = v instanceof Promise ? await v : v;
        Y(() => {
          l(_), a(!1), c(null);
        });
      } else
        l(void 0), a(!1), c(null);
    } catch (v) {
      console.error("[useModelProperty] Error updating model property:", v), l(void 0), a(!1), c(v);
    }
  }, [p, y.type, y.propertyFileId, y.modelFileId, y.propertyName, y.schemaId, y.modelName]);
  E(() => {
    if (!b) {
      l(void 0), a(!1), c(null);
      return;
    }
    g();
  }, [b, g]);
  const I = y.type === "propertyFileId";
  return E(() => {
    if (!o || !I)
      return;
    u.current?.unsubscribe();
    const d = Ne(g, 100), f = o.getService().subscribe(() => {
      d();
    });
    return u.current = f, () => {
      d.cancel(), u.current?.unsubscribe(), u.current = void 0;
    };
  }, [o, g, I]), {
    modelProperty: o,
    isLoading: n,
    error: i
  };
}
const Ar = () => {
  const e = D(void 0), [t, r] = S(!1), [s, o] = S(null), l = h(() => o(null), []), n = h(
    (a, i, c) => {
      if (o(null), r(!0), e.current?.unsubscribe(), e.current = void 0, !i || !c.name || !c.dataType) {
        const b = new Error("modelName, property name and dataType are required");
        throw o(b), r(!1), b;
      }
      const u = De(a) ?? a, p = W.create(
        { ...c, modelName: i },
        { waitForReady: !1, schemaName: u }
      ), y = p.getService().subscribe((b) => {
        if (b.value === "error") {
          const g = b.context._loadingError?.error ?? new Error("Failed to create model property");
          o(g instanceof Error ? g : new Error(String(g))), r(!1);
        }
        b.value === "idle" && (o(null), r(!1));
      });
      return e.current = y, p;
    },
    []
  );
  return E(() => () => {
    e.current?.unsubscribe(), e.current = void 0;
  }, []), {
    create: n,
    isLoading: t,
    error: s,
    resetError: l
  };
}, Pr = () => {
  const [e, t] = S(null), [r, s] = S({
    isLoading: !1,
    error: null
  });
  E(() => {
    if (!e) {
      s({ isLoading: !1, error: null });
      return;
    }
    const n = e.getService(), a = () => {
      const u = n.getSnapshot().context;
      s({
        isLoading: !!u._destroyInProgress,
        error: u._destroyError ? new Error(u._destroyError.message) : null
      });
    };
    a();
    const i = n.subscribe(a);
    return () => i.unsubscribe();
  }, [e]);
  const o = h(async (n) => {
    n && (t(n), await n.destroy());
  }, []), l = h(() => {
    e && e.getService().send({ type: "clearDestroyError" });
  }, [e]);
  return {
    destroy: o,
    isLoading: r.isLoading,
    error: r.error,
    resetError: l
  };
}, Rr = () => {
  const [e, t] = S(null), [r, s] = S({
    isLoading: !1,
    error: null
  });
  E(() => {
    if (!e) {
      s({ isLoading: !1, error: null });
      return;
    }
    const n = e.getService(), a = () => {
      const u = n.getSnapshot().context;
      s({
        isLoading: !!u._destroyInProgress,
        error: u._destroyError ? new Error(u._destroyError.message) : null
      });
    };
    a();
    const i = n.subscribe(a);
    return () => i.unsubscribe();
  }, [e]);
  const o = h(async (n) => {
    n && (t(n), await n.destroy());
  }, []), l = h(() => {
    e && e.getService().send({ type: "clearDestroyError" });
  }, [e]);
  return {
    deleteItem: o,
    isLoading: r.isLoading,
    error: r.error,
    resetError: l
  };
}, se = ["seed", "imageFiles"];
function Cr() {
  const e = P(), t = x(), {
    data: r = [],
    isLoading: s,
    error: o,
    refetch: l
  } = U({
    queryKey: se,
    queryFn: () => ve.listImageFiles(),
    enabled: e
  });
  return E(() => {
    const n = (i) => {
      i.includes("/images/") && t.invalidateQueries({ queryKey: se });
    }, a = () => {
      t.invalidateQueries({ queryKey: se });
    };
    return T.on("file-saved", n), T.on("fs.downloadAll.success", a), () => {
      T.off("file-saved", n), T.off("fs.downloadAll.success", a);
    };
  }, [t]), {
    imageFiles: r,
    isLoading: s,
    error: o instanceof Error ? o : null,
    refetch: l
  };
}
const Je = ["seed", "files"];
function Mr(e = "files") {
  const t = P(), r = x(), s = L(() => [...Je, e], [e]), {
    data: o = [],
    isLoading: l,
    error: n,
    refetch: a
  } = U({
    queryKey: s,
    queryFn: () => ve.listFiles(e),
    enabled: t
  });
  return E(() => {
    const i = (u) => {
      u.includes(`/${e}/`) && r.invalidateQueries({ queryKey: s });
    }, c = () => {
      r.invalidateQueries({ queryKey: s });
    };
    return T.on("file-saved", i), T.on("fs.downloadAll.success", c), () => {
      T.off("file-saved", i), T.off("fs.downloadAll.success", c);
    };
  }, [r, e, s]), {
    files: o,
    isLoading: l,
    error: n instanceof Error ? n : null,
    refetch: a
  };
}
const Ye = {
  queries: {
    networkMode: "offlineFirst",
    gcTime: 1e3 * 60 * 60 * 24,
    // 24 hours
    staleTime: 1e3 * 60
    // 1 minute - list data can be slightly stale
  }
};
function Ee() {
  return { ...Ye };
}
function Ge(e) {
  const t = Ee();
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
function We(e) {
  const t = Ee(), { defaultOptions: r, ...s } = e ?? {};
  return new Re({
    ...s,
    defaultOptions: r ? Ge(r) : t
  });
}
let le = null;
function Tr(e) {
  const t = le?.(e);
  return typeof window < "u" && window.__SEED_INVALIDATE_ITEM_PROPERTIES__ && window.__SEED_INVALIDATE_ITEM_PROPERTIES__(e), Promise.resolve(t).then(() => {
  });
}
function Xe({ queryClient: e }) {
  return E(() => {
    const t = (s) => {
      const o = ["seed", "itemProperties", s];
      return e.invalidateQueries({ queryKey: o }), e.refetchQueries({ queryKey: o });
    };
    le = t, typeof window < "u" && (window.__SEED_INVALIDATE_ITEM_PROPERTIES__ = t);
    const r = (s) => {
      const o = s?.seedLocalId ?? s?.seedUid;
      o && t(o);
    };
    return T.on("itemProperty.saved", r), () => {
      T.off("itemProperty.saved", r), le = null, typeof window < "u" && (window.__SEED_INVALIDATE_ITEM_PROPERTIES__ = null);
    };
  }, [e]), null;
}
function qr({ children: e, queryClient: t, queryClientRef: r }) {
  const s = L(
    () => t ?? We(),
    [t]
  );
  if (r && (r.current = s, typeof window < "u")) {
    const o = window;
    o.__TEST_SEED_QUERY_CLIENT__ = s;
    try {
      window.parent && window.parent !== window && (window.parent.__TEST_SEED_QUERY_CLIENT__ = s);
    } catch {
    }
  }
  return /* @__PURE__ */ Te(Ce, { client: s, children: [
    /* @__PURE__ */ qe(Xe, { queryClient: s }),
    e
  ] });
}
export {
  Je as FILES_QUERY_KEY_PREFIX,
  qr as SeedProvider,
  We as createSeedQueryClient,
  Ee as getSeedQueryDefaultOptions,
  ge as getServiceName,
  de as getServiceUniqueKey,
  pe as getServiceValue,
  Tr as invalidateItemPropertiesForItem,
  Ge as mergeSeedQueryDefaults,
  _r as useAllSchemaVersions,
  dr as useCreateItem,
  mr as useCreateItemProperty,
  Lr as useCreateModel,
  Ar as useCreateModelProperty,
  Er as useCreateSchema,
  gr as useDbsAreReady,
  Rr as useDeleteItem,
  br as useDestroyItemProperty,
  Dr as useDestroyModel,
  Pr as useDestroyModelProperty,
  hr as useDestroySchema,
  Mr as useFiles,
  Be as useGlobalServiceStatus,
  ke as useHasSavedSnapshots,
  Cr as useImageFiles,
  Ue as useIsDbReady,
  lr as useItem,
  pr as useItemProperties,
  yr as useItemProperty,
  ur as useItems,
  j as useLiveQuery,
  $e as useModel,
  Fr as useModelProperties,
  Nr as useModelProperty,
  je as useModels,
  Sr as usePersistedSnapshots,
  fr as usePublishItem,
  ze as useSchema,
  Ir as useSchemas,
  wr as useSeedProtocolSchema,
  vr as useService,
  Ke as useServices
};
//# sourceMappingURL=index.js.map
