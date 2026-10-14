import type { ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { Check, X } from "lucide-react";
export function Tip({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  // Visible hover labels duplicated information already expressed by the control and made the
  // interface feel noisy. Keep the prop in this shared wrapper so callers retain their
  // accessible aria-labels, but render no pointer-triggered popup.
  void label;
  return <>{children}</>;
}
export function IconButton({
  label,
  children,
  onClick,
  className = "",
  disabled = false,
}: {
  label: string;
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <Tip label={label}>
      <button
        className={`icon-button ${className}`}
        aria-label={label}
        onClick={onClick}
        disabled={disabled}
      >
        {children}
      </button>
    </Tip>
  );
}
export interface MenuOption {
  label: string;
  description?: string;
  icon?: ReactNode;
  onSelect?: () => void;
  selected?: boolean;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
  /** A group heading ("Model", "Effort"): not selectable, read as a label by menu readers. */
  heading?: boolean;
}
export function Dropdown({
  trigger,
  items,
  label,
  side = "bottom",
  align = "start",
}: {
  trigger: ReactNode;
  items: MenuOption[];
  label: string;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "end";
}) {
  return (
    <Menu.Root>
      <Menu.Trigger asChild>{trigger}</Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          aria-label={label}
          className="dropdown"
          side={side}
          align={align}
          sideOffset={7}
          collisionPadding={12}
        >
          {items.map((item, i) => (
            <div key={item.label}>
              {item.separator && i > 0 && (
                <Menu.Separator className="menu-separator" />
              )}
              {item.heading ? (
                <Menu.Label className="menu-heading">{item.label}</Menu.Label>
              ) : (
                <Menu.Item
                  className={`menu-item ${item.danger ? "danger" : ""}`}
                  onSelect={item.onSelect}
                  disabled={item.disabled}
                  data-selected={item.selected ? "true" : undefined}
                >
                  {item.icon}
                  <span>
                    {item.label}
                    {item.description && <small>{item.description}</small>}
                  </span>
                  {item.selected && <Check size={15} className="menu-check" />}
                </Menu.Item>
              )}
            </div>
          ))}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  className = "",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content
          className={`modal ${className}`}
          aria-describedby={description ? "modal-description" : undefined}
        >
          <div className="modal-heading">
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close asChild>
              <button className="icon-button" aria-label={`Close ${title}`}>
                <X size={19} />
              </button>
            </Dialog.Close>
          </div>
          {description && (
            <Dialog.Description
              id="modal-description"
              className="modal-description"
            >
              {description}
            </Dialog.Description>
          )}
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function BrandMark() {
  return (
    <span className="arcnave-mark" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}
