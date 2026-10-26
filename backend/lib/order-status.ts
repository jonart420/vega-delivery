/** Order statuses (shared by server and client code). */
export type OrderStatus = "open" | "planned" | "out_for_delivery" | "delivered" | "failed" | "cancelled";
export const ORDER_STATUSES: OrderStatus[] = ["open", "planned", "out_for_delivery", "delivered", "failed", "cancelled"];
