import { useAdminStore } from "@/state/admin-store";

export function AdminModeToggle() {
  const isAdminMode = useAdminStore((state) => state.isAdminMode);
  const toggleAdminMode = useAdminStore((state) => state.toggleAdminMode);

  return (
    <button
      className={`admin-mode-toggle${isAdminMode ? " is-active" : ""}`}
      onClick={toggleAdminMode}
      type="button"
    >
      {isAdminMode ? "Editorial mode on" : "Editorial mode"}
    </button>
  );
}
