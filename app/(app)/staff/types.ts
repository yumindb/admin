export type StaffActionResult = {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string[]>;
};
