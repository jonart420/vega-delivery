"use client";

import { useI18n } from "./I18nProvider";

const CLS: Record<string, string> = {
  draft: "",
  released: "badge-accent",
  in_progress: "badge-warning",
  done: "badge-success",
};

export default function TourStatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  return <span className={`badge ${CLS[status] ?? ""}`}>{t(`tour_status.${status}`)}</span>;
}

const ORDER_CLS: Record<string, string> = {
  open: "",
  planned: "badge-accent",
  out_for_delivery: "badge-warning",
  delivered: "badge-success",
  failed: "badge-danger",
  cancelled: "",
};

export function OrderStatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  return <span className={`badge ${ORDER_CLS[status] ?? ""}`}>{t(`order_status.${status}`)}</span>;
}

const STOP_CLS: Record<string, string> = {
  pending: "",
  arrived: "badge-warning",
  delivered: "badge-success",
  failed: "badge-danger",
  skipped: "badge-danger",
};

export function StopStatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  return <span className={`badge ${STOP_CLS[status] ?? ""}`}>{t(`stop_status.${status}`)}</span>;
}
