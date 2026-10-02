export const QUEUE_PAYMENT_RECONCILE = "payment-reconcile";
export const QUEUE_RESERVATION_EXPIRY = "reservation-expiry";
export const QUEUE_SEARCH_INDEX = "search-index";
export const QUEUE_SYNC_RUN = "sync-run";
export const QUEUE_NOTIFICATIONS = "notifications";

export const JOB_RECONCILE_PENDING = "reconcile-pending-orders";
export const JOB_EXPIRE_RESERVATIONS = "expire-reservations";
/** Per-order delayed job — fires 30 min after order creation if still pending_payment. */
export const JOB_EXPIRE_SINGLE_RESERVATION = "expire-single-reservation";
export const JOB_INDEX_PRODUCT = "index-product";
export const JOB_DELETE_INDEX = "delete-from-index";
export const JOB_SEND_EMAIL = "send-email";
