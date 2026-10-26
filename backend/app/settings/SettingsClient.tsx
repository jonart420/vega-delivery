"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { api } from "@/components/api";
import { useI18n } from "@/components/I18nProvider";
import PlaceSearch from "@/components/PlaceSearch";
import type { Outcome, Reason } from "@/lib/outcomes";
import type { NotifyKind, Template } from "@/lib/notify/templates";
import type { Setting, SettingKey } from "@/lib/settings";

type AllSettings = { [K in SettingKey]: Setting<K> };
const TABS = ["general", "outcomes", "notifications", "barcodes"] as const;
const KINDS: NotifyKind[] = ["day_start", "approaching", "manual", "delivered", "failed"];

export default function SettingsClient(props: {
  initialTab: string;
  isAdmin: boolean;
  settings: AllSettings;
  outcomes: Outcome[];
  reasons: Reason[];
  channels: { email: boolean; whatsapp: boolean; whatsapp_provider: string };
  defaultTemplates: Record<NotifyKind | "test", Record<"en" | "de", Template>>;
}) {
  const { t } = useI18n();
  const router = useRouter();
  // The tab lives in the URL (?tab=…) so the sidebar links and the tab bar stay in sync
  const urlTab = useSearchParams().get("tab") ?? props.initialTab;
  const tab = TABS.includes(urlTab as (typeof TABS)[number]) ? urlTab : "general";
  const setTab = (k: string) => router.replace(`/settings?tab=${k}`, { scroll: false });
  const [s, setS] = useState(props.settings);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const ro = !props.isAdmin;

  async function save<K extends SettingKey>(key: K, value: Setting<K>) {
    setMessage(null);
    try {
      const r = await api<{ value: Setting<K> }>("/api/settings", "PUT", { key, value });
      setS((cur) => ({ ...cur, [key]: r.value }));
      setMessage({ ok: true, text: t("common.saved") });
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    }
  }

  return (
    <main className="page">
      <h1 className="page-title">{t("settings.title")}</h1>
      {ro && <div className="alert">{t("settings.read_only")}</div>}
      <div className="tabs">
        {TABS.map((k) => (
          <button key={k} className={`tab ${tab === k ? "tab-active" : ""}`} onClick={() => { setTab(k); setMessage(null); }}>
            {t(`settings.tab_${k}`)}
          </button>
        ))}
      </div>
      {message && <div className={`alert ${message.ok ? "alert-ok" : "alert-error"}`}>{message.text}</div>}

      {tab === "general" && <General s={s} setS={setS} save={save} ro={ro} />}
      {tab === "outcomes" && <Outcomes outcomes={props.outcomes} reasons={props.reasons} ro={ro} onChange={() => router.refresh()} setMessage={setMessage} />}
      {tab === "notifications" && <Notifications s={s} setS={setS} save={save} ro={ro} channels={props.channels} defaults={props.defaultTemplates} setMessage={setMessage} />}
      {tab === "barcodes" && <Barcodes s={s} setS={setS} save={save} ro={ro} />}
    </main>
  );
}

type SectionProps = {
  s: AllSettings;
  setS: React.Dispatch<React.SetStateAction<AllSettings>>;
  save: <K extends SettingKey>(key: K, value: Setting<K>) => Promise<void>;
  ro: boolean;
};

function General({ s, setS, save, ro }: SectionProps) {
  const { t } = useI18n();
  const c = s.company;
  const d = s.depot;
  const td = s.tour_defaults;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="card space-y-3 p-4">
        <h2 className="font-medium">{t("settings.company")}</h2>
        {(["name", "phone", "email", "website"] as const).map((k) => (
          <label key={k} className="field">
            <span>{t(`settings.company_${k}`)}</span>
            <input disabled={ro} value={c[k]} onChange={(e) => setS({ ...s, company: { ...c, [k]: e.target.value } })} />
          </label>
        ))}
        {!ro && <button className="btn-primary" onClick={() => save("company", s.company)}>{t("common.save")}</button>}
      </section>
      <section className="card space-y-3 p-4">
        <h2 className="font-medium">{t("settings.depot")}</h2>
        <p className="muted text-sm">{t("settings.depot_hint")}</p>
        {!ro && (
          <PlaceSearch
            getCenter={() => (d.lat != null ? { lat: d.lat, lon: d.lon! } : null)}
            onPick={(r) => setS({ ...s, depot: { label: r.sublabel ? `${r.label}, ${r.sublabel}` : r.label, lat: r.lat, lon: r.lon } })}
          />
        )}
        <p className="text-sm">{d.label || t("tours.not_set")}{d.lat != null && <span className="muted"> ({d.lat.toFixed(5)}, {d.lon?.toFixed(5)})</span>}</p>
        {!ro && <button className="btn-primary" disabled={d.lat == null} onClick={() => save("depot", s.depot)}>{t("common.save")}</button>}

        <h2 className="pt-2 font-medium">{t("settings.tour_defaults")}</h2>
        <div className="grid grid-cols-3 gap-2">
          <label className="field">
            <span>{t("tours.planned_start")}</span>
            <input type="time" disabled={ro} value={td.planned_start} onChange={(e) => setS({ ...s, tour_defaults: { ...td, planned_start: e.target.value } })} />
          </label>
          <label className="field">
            <span>{t("customers.dwell")}</span>
            <input type="number" min={0} max={120} disabled={ro} value={td.dwell_minutes} onChange={(e) => setS({ ...s, tour_defaults: { ...td, dwell_minutes: Number(e.target.value) } })} />
          </label>
          <label className="field">
            <span>{t("settings.mode")}</span>
            <select disabled={ro} value={td.mode} onChange={(e) => setS({ ...s, tour_defaults: { ...td, mode: e.target.value as typeof td.mode } })}>
              {(["auto", "bicycle", "pedestrian"] as const).map((m) => <option key={m} value={m}>{t(`modes.${m}`)}</option>)}
            </select>
          </label>
        </div>
        {!ro && <button className="btn-primary" onClick={() => save("tour_defaults", s.tour_defaults)}>{t("common.save")}</button>}
      </section>
    </div>
  );
}

function Barcodes({ s, setS, save, ro }: SectionProps) {
  const { t } = useI18n();
  const b = s.barcodes;
  return (
    <section className="card max-w-2xl space-y-3 p-4">
      <h2 className="font-medium">{t("settings.barcodes")}</h2>
      <p className="muted text-sm">{t("settings.barcodes_hint")}</p>
      <label className="check">
        <input type="radio" disabled={ro} checked={b.mode === "per_delivery"} onChange={() => setS({ ...s, barcodes: { ...b, mode: "per_delivery" } })} />
        <span><b>{t("settings.barcode_per_delivery")}</b> – {t("settings.barcode_per_delivery_hint")}</span>
      </label>
      <label className="check">
        <input type="radio" disabled={ro} checked={b.mode === "per_customer"} onChange={() => setS({ ...s, barcodes: { ...b, mode: "per_customer" } })} />
        <span><b>{t("settings.barcode_per_customer")}</b> – {t("settings.barcode_per_customer_hint")}</span>
      </label>
      <label className="field max-w-40">
        <span>{t("settings.ean_prefix")}</span>
        <input disabled={ro} maxLength={2} value={b.ean13_prefix} onChange={(e) => setS({ ...s, barcodes: { ...b, ean13_prefix: e.target.value } })} />
      </label>
      <p className="muted text-xs">{t("settings.ean_prefix_hint")}</p>
      <p className="muted text-xs">{t("settings.indicator_hint")}</p>
      <label className="field max-w-md">
        <span>{t("settings.scan_accept")}</span>
        <select disabled={ro} value={b.scan_accept} onChange={(e) => setS({ ...s, barcodes: { ...b, scan_accept: e.target.value as typeof b.scan_accept } })}>
          <option value="any">{t("settings.scan_accept_any")}</option>
          <option value="customer">{t("settings.scan_accept_customer")}</option>
          <option value="delivery">{t("settings.scan_accept_delivery")}</option>
        </select>
      </label>
      <p className="muted text-xs">{t("settings.scan_accept_hint")}</p>
      {!ro && <button className="btn-primary" onClick={() => save("barcodes", s.barcodes)}>{t("common.save")}</button>}
    </section>
  );
}

function Notifications({
  s, setS, save, ro, channels, defaults, setMessage,
}: SectionProps & {
  channels: { email: boolean; whatsapp: boolean; whatsapp_provider: string };
  defaults: Record<NotifyKind | "test", Record<"en" | "de", Template>>;
  setMessage: (m: { ok: boolean; text: string } | null) => void;
}) {
  const { t } = useI18n();
  const n = s.notifications;
  const [kind, setKind] = useState<NotifyKind>("approaching");
  const [lang, setLang] = useState<"de" | "en">("de");
  const [testTo, setTestTo] = useState("");
  const [testChannel, setTestChannel] = useState<"email" | "whatsapp">(channels.email ? "email" : "whatsapp");
  const key = `${kind}.${lang}`;
  const tpl = s.templates[key] ?? defaults[kind][lang];
  const custom = !!s.templates[key];

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="card space-y-3 p-4">
        <h2 className="font-medium">{t("settings.channels")}</h2>
        <ul className="space-y-1 text-sm">
          <li>{t("channels.email")}: <span className={`badge ${channels.email ? "badge-success" : ""}`}>{channels.email ? t("settings.configured") : t("settings.not_configured")}</span></li>
          <li>{t("channels.whatsapp")}: <span className={`badge ${channels.whatsapp ? "badge-success" : ""}`}>{channels.whatsapp ? channels.whatsapp_provider : t("settings.not_configured")}</span></li>
        </ul>
        <p className="muted text-xs">{t("settings.channels_hint")}</p>

        <h2 className="pt-2 font-medium">{t("settings.automation")}</h2>
        <label className="field max-w-48">
          <span>{t("settings.lead_stops")}</span>
          <input type="number" min={1} max={20} disabled={ro} value={n.lead_stops} onChange={(e) => setS({ ...s, notifications: { ...n, lead_stops: Number(e.target.value) } })} />
        </label>
        <p className="muted text-xs">{t("settings.lead_stops_hint", { n: n.lead_stops })}</p>
        {(["day_start", "approaching", "delivered", "failed"] as const).map((k) => (
          <label key={k} className="check">
            <input type="checkbox" disabled={ro} checked={n[k]} onChange={(e) => setS({ ...s, notifications: { ...n, [k]: e.target.checked } })} />
            {t(`settings.auto_${k}`)}
          </label>
        ))}
        <label className="field max-w-48">
          <span>{t("settings.eta_window")}</span>
          <input type="number" min={10} max={480} disabled={ro} value={n.eta_window_minutes} onChange={(e) => setS({ ...s, notifications: { ...n, eta_window_minutes: Number(e.target.value) } })} />
        </label>
        {!ro && <button className="btn-primary" onClick={() => save("notifications", s.notifications)}>{t("common.save")}</button>}

        {!ro && (
          <div className="space-y-2 border-t border-[var(--border)] pt-3">
            <h2 className="font-medium">{t("settings.test_message")}</h2>
            <div className="flex flex-wrap gap-2">
              <select className="input !w-auto" value={testChannel} onChange={(e) => setTestChannel(e.target.value as "email" | "whatsapp")}>
                <option value="email">{t("channels.email")}</option>
                <option value="whatsapp">{t("channels.whatsapp")}</option>
              </select>
              <input className="input max-w-64" placeholder={testChannel === "email" ? "name@example.com" : "+49…"} value={testTo} onChange={(e) => setTestTo(e.target.value)} />
              <button className="btn" disabled={!testTo} onClick={async () => {
                try {
                  await api("/api/settings/test", "POST", { channel: testChannel, recipient: testTo });
                  setMessage({ ok: true, text: t("settings.test_sent") });
                } catch (e) {
                  setMessage({ ok: false, text: (e as Error).message });
                }
              }}>
                {t("settings.send_test")}
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="font-medium">{t("settings.templates")}</h2>
        <div className="flex flex-wrap gap-2">
          <select className="input !w-auto" value={kind} onChange={(e) => setKind(e.target.value as NotifyKind)}>
            {KINDS.map((k) => <option key={k} value={k}>{t(`notify_kind.${k}`)}</option>)}
          </select>
          <select className="input !w-auto" value={lang} onChange={(e) => setLang(e.target.value as "de" | "en")}>
            <option value="de">Deutsch</option>
            <option value="en">English</option>
          </select>
          {custom && <span className="badge badge-accent self-center">{t("settings.customized")}</span>}
        </div>
        <label className="field">
          <span>{t("settings.subject")}</span>
          <input disabled={ro} value={tpl.subject} onChange={(e) => setS({ ...s, templates: { ...s.templates, [key]: { ...tpl, subject: e.target.value } } })} />
        </label>
        <label className="field">
          <span>{t("settings.body")}</span>
          <textarea rows={10} disabled={ro} value={tpl.body} onChange={(e) => setS({ ...s, templates: { ...s.templates, [key]: { ...tpl, body: e.target.value } } })} />
        </label>
        <p className="muted text-xs">{t("settings.placeholders")}: {"{{customer_name}} {{company}} {{eta}} {{eta_window}} {{date}} {{tracking_link}} {{stops_ahead}} {{order_numbers}} {{driver_name}}"}</p>
        <p className="muted text-xs">{t("settings.whatsapp_template_hint")}</p>
        {!ro && (
          <div className="flex gap-2">
            <button className="btn-primary" onClick={() => save("templates", s.templates)}>{t("common.save")}</button>
            {custom && (
              <button className="btn" onClick={() => {
                const next = { ...s.templates };
                delete next[key];
                save("templates", next);
              }}>
                {t("settings.reset_template")}
              </button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

const EMPTY_OUTCOME: Outcome = {
  code: "", label_en: "", label_de: "", kind: "failure", icon: null, color: "#64748b", requires_reason: false, requires_photo: false,
  requires_signature: false, requires_recipient: false, requires_scan: false, final: true, active: true, sort: 100, system: false,
};

function Outcomes({
  outcomes, reasons, ro, onChange, setMessage,
}: {
  outcomes: Outcome[];
  reasons: Reason[];
  ro: boolean;
  onChange: () => void;
  setMessage: (m: { ok: boolean; text: string } | null) => void;
}) {
  const { t, locale } = useI18n();
  const [edit, setEdit] = useState<(Outcome & { isNew?: boolean }) | null>(null);
  const [reasonDraft, setReasonDraft] = useState<{ id?: string; outcome_code: string; label_en: string; label_de: string; active: boolean; sort: number } | null>(null);

  async function run(fn: () => Promise<unknown>, ok = t("common.saved")) {
    try {
      await fn();
      setMessage({ ok: true, text: ok });
      onChange();
      return true;
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
      return false;
    }
  }

  const flags = ["requires_reason", "requires_photo", "requires_signature", "requires_recipient", "requires_scan", "final", "active"] as const;

  return (
    <div className="space-y-4">
      <p className="muted text-sm">{t("settings.outcomes_hint")}</p>
      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>{t("settings.outcome")}</th>
              <th>{t("settings.kind")}</th>
              <th>{t("settings.requires")}</th>
              <th>{t("settings.reasons")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {outcomes.map((o) => (
              <tr key={o.code} className={o.active ? "" : "opacity-50"}>
                <td>
                  <span className="mr-2 inline-block h-3 w-3 rounded-full align-middle" style={{ background: o.color ?? "#999" }} />
                  <b>{locale === "de" ? o.label_de : o.label_en}</b>
                  <span className="muted ml-2 font-mono text-xs">{o.code}</span>
                </td>
                <td><span className={`badge ${o.kind === "success" ? "badge-success" : o.kind === "failure" ? "badge-danger" : ""}`}>{t(`outcome_kind.${o.kind}`)}</span></td>
                <td className="space-x-1 text-xs">
                  {flags.slice(0, 5).filter((f) => o[f]).map((f) => <span key={f} className="chip">{t(`settings.${f}`)}</span>)}
                </td>
                <td className="text-xs">
                  {reasons.filter((r) => r.outcome_code === o.code).map((r) => (
                    <button key={r.id} disabled={ro} className={`chip mr-1 mb-1 ${r.active ? "" : "line-through opacity-60"}`}
                      onClick={() => setReasonDraft({ id: r.id, outcome_code: r.outcome_code, label_en: r.label_en, label_de: r.label_de, active: r.active, sort: r.sort })}>
                      {locale === "de" ? r.label_de : r.label_en}
                    </button>
                  ))}
                  {!ro && (
                    <button className="chip" onClick={() => setReasonDraft({ outcome_code: o.code, label_en: "", label_de: "", active: true, sort: 100 })}>+ {t("settings.reason")}</button>
                  )}
                </td>
                <td className="text-right">{!ro && <button className="btn btn-sm" onClick={() => setEdit({ ...o })}>{t("common.edit")}</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!ro && <button className="btn" onClick={() => setEdit({ ...EMPTY_OUTCOME, isNew: true })}>{t("settings.new_outcome")}</button>}

      {reasonDraft && (
        <section className="card max-w-2xl space-y-3 p-4">
          <h2 className="font-medium">{reasonDraft.id ? t("settings.edit_reason") : t("settings.new_reason")}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="field">
              <span>{t("settings.label_de")}</span>
              <input autoFocus value={reasonDraft.label_de} onChange={(e) => setReasonDraft({ ...reasonDraft, label_de: e.target.value })} />
            </label>
            <label className="field">
              <span>{t("settings.label_en")}</span>
              <input value={reasonDraft.label_en} onChange={(e) => setReasonDraft({ ...reasonDraft, label_en: e.target.value })} />
            </label>
            <label className="field">
              <span>{t("settings.outcome")}</span>
              <select value={reasonDraft.outcome_code} onChange={(e) => setReasonDraft({ ...reasonDraft, outcome_code: e.target.value })}>
                {outcomes.map((o) => <option key={o.code} value={o.code}>{locale === "de" ? o.label_de : o.label_en}</option>)}
              </select>
            </label>
            <label className="field">
              <span>{t("products.sort")}</span>
              <input type="number" value={reasonDraft.sort} onChange={(e) => setReasonDraft({ ...reasonDraft, sort: Number(e.target.value) })} />
            </label>
          </div>
          <label className="check">
            <input type="checkbox" checked={reasonDraft.active} onChange={(e) => setReasonDraft({ ...reasonDraft, active: e.target.checked })} />
            {t("settings.active")}
          </label>
          <div className="flex gap-2">
            <button className="btn-primary" disabled={!reasonDraft.label_de.trim() || !reasonDraft.label_en.trim()} onClick={async () => {
              const { id, ...body } = reasonDraft;
              if (await run(() => (id ? api(`/api/reasons/${id}`, "PUT", body) : api("/api/reasons", "POST", body)))) setReasonDraft(null);
            }}>
              {t("common.save")}
            </button>
            <button className="btn" onClick={() => setReasonDraft(null)}>{t("common.cancel")}</button>
            {reasonDraft.id && (
              <button className="btn btn-danger ml-auto" onClick={async () => {
                if (await run(() => api(`/api/reasons/${reasonDraft.id}`, "DELETE"))) setReasonDraft(null);
              }}>
                {t("common.delete")}
              </button>
            )}
          </div>
        </section>
      )}

      {edit && (
        <section className="card max-w-2xl space-y-3 p-4">
          <h2 className="font-medium">{edit.isNew ? t("settings.new_outcome") : t("settings.edit_outcome")}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="field">
              <span>{t("settings.code")}</span>
              <input disabled={!edit.isNew} value={edit.code} placeholder="e.g. damaged_on_site" onChange={(e) => setEdit({ ...edit, code: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })} />
            </label>
            <label className="field">
              <span>{t("settings.kind")}</span>
              <select disabled={edit.system} value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value as Outcome["kind"] })}>
                {(["success", "failure", "neutral"] as const).map((k) => <option key={k} value={k}>{t(`outcome_kind.${k}`)}</option>)}
              </select>
            </label>
            <label className="field">
              <span>{t("settings.label_de")}</span>
              <input value={edit.label_de} onChange={(e) => setEdit({ ...edit, label_de: e.target.value })} />
            </label>
            <label className="field">
              <span>{t("settings.label_en")}</span>
              <input value={edit.label_en} onChange={(e) => setEdit({ ...edit, label_en: e.target.value })} />
            </label>
            <label className="field">
              <span>{t("settings.color")}</span>
              <input type="color" value={edit.color ?? "#64748b"} onChange={(e) => setEdit({ ...edit, color: e.target.value })} />
            </label>
            <label className="field">
              <span>{t("products.sort")}</span>
              <input type="number" value={edit.sort} onChange={(e) => setEdit({ ...edit, sort: Number(e.target.value) })} />
            </label>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {flags.map((f) => (
              <label key={f} className="check">
                <input type="checkbox" disabled={f === "active" && edit.system} checked={edit[f]} onChange={(e) => setEdit({ ...edit, [f]: e.target.checked })} />
                {t(`settings.${f}`)}
              </label>
            ))}
          </div>
          <p className="muted text-xs">{t("settings.final_hint")}</p>
          <div className="flex gap-2">
            <button className="btn-primary" disabled={!edit.code || !edit.label_de.trim() || !edit.label_en.trim()} onClick={async () => {
              const { isNew: _n, system: _s, ...body } = edit;
              if (await run(() => api("/api/outcomes", "POST", body))) setEdit(null);
            }}>
              {t("common.save")}
            </button>
            <button className="btn" onClick={() => setEdit(null)}>{t("common.cancel")}</button>
            {!edit.isNew && !edit.system && (
              <button className="btn btn-danger ml-auto" onClick={async () => {
                if (!confirm(t("settings.confirm_delete_outcome"))) return;
                if (await run(() => api(`/api/outcomes/${edit.code}`, "DELETE"))) setEdit(null);
              }}>
                {t("common.delete")}
              </button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
