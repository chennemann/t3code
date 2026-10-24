import { MessageCircleIcon } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";

/** A compact badge without flattening editable marks into the attachment thumbnail. */
export function ImageAnnotationIndicator({ count }: { count: number }) {
  if (!count) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            aria-label={`${count} image annotations`}
            className="absolute bottom-0 right-0 z-10 flex items-center gap-0.5 rounded-tl bg-background px-1 py-0.5 text-2xs font-medium text-foreground shadow"
          />
        }
      >
        <MessageCircleIcon className="size-3" />
        {count}
      </TooltipTrigger>
      <TooltipPopup>{count} annotations. Open image to view or edit</TooltipPopup>
    </Tooltip>
  );
}
