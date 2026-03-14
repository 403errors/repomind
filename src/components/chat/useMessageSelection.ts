import { useRef, useState, type RefObject } from "react";

interface SelectionAnchor {
    x: number;
    y: number;
}

interface UseMessageSelectionResult {
    selectionAnchor: SelectionAnchor | null;
    referenceText: string;
    handleSelection: () => void;
    handleAskFromSelection: () => void;
    clearReference: () => void;
}

export function useMessageSelection(
    chatScrollRef: RefObject<HTMLDivElement | null>
): UseMessageSelectionResult {
    const [selectionText, setSelectionText] = useState("");
    const [selectionAnchor, setSelectionAnchor] = useState<SelectionAnchor | null>(null);
    const [referenceText, setReferenceText] = useState("");
    const selectedRangeRef = useRef<Range | null>(null);
    const selectionTextRef = useRef("");

    const resetSelection = () => {
        setSelectionAnchor(null);
        setSelectionText("");
        selectionTextRef.current = "";
        selectedRangeRef.current = null;
    };

    const handleSelection = () => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) {
            resetSelection();
            return;
        }

        const getModelContainer = (node: Node | null) => {
            const element = node instanceof Element ? node : node?.parentElement;
            return element?.closest('[data-message-role="model"]') ?? null;
        };

        const startContainer = getModelContainer(selection.anchorNode);
        const endContainer = getModelContainer(selection.focusNode);
        if (!startContainer || startContainer !== endContainer) {
            resetSelection();
            return;
        }

        const scrollContainer = chatScrollRef.current;
        if (!scrollContainer) {
            return;
        }

        const range = selection.getRangeAt(0).cloneRange();
        const rect = range.getBoundingClientRect();
        const containerRect = scrollContainer.getBoundingClientRect();

        const text = selection.toString().trim();
        if (!text) {
            resetSelection();
            return;
        }

        const x = rect.left - containerRect.left + rect.width / 2;
        const y = rect.top - containerRect.top + scrollContainer.scrollTop;

        setSelectionAnchor({ x, y });
        setSelectionText(text);
        selectionTextRef.current = text;
        selectedRangeRef.current = range;

        requestAnimationFrame(() => {
            const savedRange = selectedRangeRef.current;
            const restoredSelection = window.getSelection();
            if (!savedRange || !restoredSelection) return;
            restoredSelection.removeAllRanges();
            try {
                restoredSelection.addRange(savedRange);
            } catch {
                // Ignore detached/stale range errors.
            }
        });
    };

    const handleAskFromSelection = () => {
        const text = selectionTextRef.current || selectionText;
        if (!text) {
            return;
        }

        setReferenceText(text);
        resetSelection();
        chatScrollRef.current?.scrollTo({
            top: chatScrollRef.current.scrollHeight,
            behavior: "smooth",
        });
    };

    const clearReference = () => {
        setReferenceText("");
    };

    return {
        selectionAnchor,
        referenceText,
        handleSelection,
        handleAskFromSelection,
        clearReference,
    };
}
