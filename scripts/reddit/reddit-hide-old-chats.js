// ==UserScript==
// @name         Reddit Hide Old Chats
// @namespace    https://reddit.com/
// @version      0.0.1
// @description  Hide old Reddit chats in the chat list
// @author       Landmine
// @match        https://www.reddit.com/chat*
// @grant        none
// @icon         https://www.reddit.com/favicon.ico
// @run-at       document-idle
// @noframes
// @updateURL    https://raw.githubusercontent.com/Landmine-1252/userscripts/main/scripts/reddit/reddit-hide-old-chats.user.js
// @downloadURL  https://raw.githubusercontent.com/Landmine-1252/userscripts/main/scripts/reddit/reddit-hide-old-chats.user.js
// ==/UserScript==

(function () {
    "use strict";

    const CONFIG = {
        version: "0.0.1",
        defaultDays: 30,

        initialDelayMs: 1000,
        chatListLoadTimeoutMs: 12000,
        chatOpenDelayMs: 600,
        chatOpenTimeoutMs: 12000,
        chatOpenRetryMs: 2500,
        routeOnlyReadyMs: 1800,
        messageLoadTimeoutMs: 6000,
        messagePollMs: 200,

        settingsOpenDelayMs: 300,
        confirmationDelayMs: 300,
        postHideDelayMs: 600,

        scrollDelayMs: 500,
        scrollFraction: 0.7,
        maxScrollStalls: 5,
        maxLogEntries: 300,

        storageDaysKey: "redditHideOldChats.days",
        storageWorkflowModeKey: "redditHideOldChats.workflowMode",
        storageCollapsedKey: "redditHideOldChats.collapsed",
        storagePositionKey: "redditHideOldChats.position",
    };

    const CHAT_ITEM_SELECTOR = [
        "rs-rooms-nav-room",
        "rs-room-list-item",
        "[data-testid='chat-room-list-item']",
        "[data-testid*='room-list-item']",
        "[data-room-id]",
        "[room-id]",
    ].join(",");

    const CHAT_LINK_SELECTOR = "a[href*='/chat/room/']";

    const state = {
        running: false,
        stopRequested: false,
        processedRoomIds: new Set(),
        candidates: new Map(),
        logRecords: [],
        currentChatName: null,
        stats: {
            checked: 0,
            old: 0,
            hidden: 0,
            skipped: 0,
            errors: 0,
        },
    };

    function sleep(ms) {
        return new Promise((resolve) => {
            window.setTimeout(resolve, ms);
        });
    }

    function normalizeText(value) {
        return String(value || "")
            .replace(/\s+/g, " ")
            .trim();
    }

    function isVisible(element) {
        if (!element) {
            return false;
        }

        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);

        return (
            style.display !== "none"
            && style.visibility !== "hidden"
            && style.opacity !== "0"
            && rect.width > 0
            && rect.height > 0
        );
    }

    function isVisibleOrContainsVisibleContent(element) {
        if (isVisible(element)) {
            return true;
        }

        if (!element) {
            return false;
        }

        return deepQueryAll("*", element).some(isVisible);
    }

    /**
     * Query through the normal DOM and every reachable open Shadow DOM.
     */
    function deepQueryAll(selector, root = document) {
        const results = [];
        const visited = new Set();

        function walk(queryRoot) {
            if (!queryRoot || visited.has(queryRoot)) {
                return;
            }

            visited.add(queryRoot);

            if (queryRoot.querySelectorAll) {
                try {
                    results.push(...queryRoot.querySelectorAll(selector));
                } catch (error) {
                    console.debug(
                        "[Reddit Hide Old Chats] Query failed:",
                        selector,
                        error
                    );
                }
            }

            /*
             * A caller often passes a web-component host as the root. Enter
             * that host's own shadow tree as well as shadow trees belonging
             * to its descendants. The previous walker missed the former.
             */
            if (queryRoot.shadowRoot) {
                walk(queryRoot.shadowRoot);
            }

            if (queryRoot.querySelectorAll) {
                for (const descendant of queryRoot.querySelectorAll("*")) {
                    if (descendant.shadowRoot) {
                        walk(descendant.shadowRoot);
                    }
                }
            }
        }

        walk(root);

        return [...new Set(results)];
    }

    function deepQuery(selector, root = document) {
        return deepQueryAll(selector, root)[0] || null;
    }

    function composedParent(element) {
        if (!element) {
            return null;
        }

        if (element.parentElement) {
            return element.parentElement;
        }

        const root = element.getRootNode?.();

        return root instanceof ShadowRoot ? root.host : null;
    }

    function composedClosest(element, selector) {
        let current = element;

        while (current) {
            if (current.matches?.(selector)) {
                return current;
            }

            current = composedParent(current);
        }

        return null;
    }

    function getChatLink(chatItem) {
        if (!chatItem) {
            return null;
        }

        if (chatItem.matches?.(CHAT_LINK_SELECTOR)) {
            return chatItem;
        }

        const routedLink = deepQuery(CHAT_LINK_SELECTOR, chatItem);

        if (routedLink) {
            return routedLink;
        }

        /*
         * Reddit's current rs-rooms-nav-room component does not always put a
         * /chat/room/ URL in the anchor. The component itself owns the room
         * ID and its internal `div > a` is still the intended click target.
         */
        return deepQuery("div > a", chatItem)
            || deepQuery("a", chatItem);
    }

    function normalizeRoomId(value) {
        let normalized = normalizeText(value);

        if (!normalized) {
            return null;
        }

        /* Handle both normally encoded and accidentally double-encoded IDs. */
        for (let attempt = 0; attempt < 2; attempt += 1) {
            try {
                const decoded = decodeURIComponent(normalized);

                if (decoded === normalized) {
                    break;
                }

                normalized = decoded;
            } catch {
                break;
            }
        }

        return normalized;
    }

    function roomIdFromHref(href) {
        if (!href) {
            return null;
        }

        try {
            const url = new URL(href, location.href);
            const match = url.pathname.match(/\/chat\/room\/([^/]+)/i);

            return match ? normalizeRoomId(match[1]) : null;
        } catch (error) {
            console.debug(
                "[Reddit Hide Old Chats] Could not parse room URL:",
                error
            );

            return null;
        }
    }

    function getRoomId(chatItem) {
        if (!chatItem) {
            return null;
        }

        const linkRoomId = roomIdFromHref(getChatLink(chatItem)?.href);

        /* The clicked URL is the authoritative navigation target. */
        if (linkRoomId) {
            return linkRoomId;
        }

        const attributes = [
            "room",
            "room-id",
            "data-room-id",
            "data-roomid",
        ];

        for (const name of attributes) {
            const value = chatItem.getAttribute?.(name);

            if (value) {
                return normalizeRoomId(value);
            }
        }

        return null;
    }

    function canonicalizeChatItems(candidates) {
        const itemsByRoomId = new Map();

        for (const candidate of candidates) {
            const item = composedClosest(candidate, CHAT_ITEM_SELECTOR)
                || candidate;
            const roomId = getRoomId(item);

            if (
                !roomId
                || !isVisibleOrContainsVisibleContent(item)
                || item.closest?.("#rhoc-panel")
            ) {
                continue;
            }

            const existing = itemsByRoomId.get(roomId);

            /* Prefer Reddit's room component over a bare link. */
            if (!existing || existing.matches?.(CHAT_LINK_SELECTOR)) {
                itemsByRoomId.set(roomId, item);
            }
        }

        return [...itemsByRoomId.values()];
    }

    function getChatItems(container = document) {
        if (!container) {
            return [];
        }

        return canonicalizeChatItems([
            ...deepQueryAll(CHAT_ITEM_SELECTOR, container),
            ...deepQueryAll(CHAT_LINK_SELECTOR, container),
        ]);
    }

    function describeElement(element) {
        if (!element) {
            return "none";
        }

        if (element instanceof ShadowRoot) {
            return `${describeElement(element.host)}::shadow-root`;
        }

        const tag = element.tagName?.toLowerCase() || "unknown";
        const id = element.id ? `#${element.id}` : "";
        const classes = [...(element.classList || [])]
            .slice(0, 2)
            .map((name) => `.${name}`)
            .join("");

        return `${tag}${id}${classes}`;
    }

    function locateChatList() {
        const preferredContainers = deepQueryAll([
            "rs-roving-focus-wrapper",
            "rs-roving-focus-native",
            "rs-rooms-nav",
            "[data-testid='chat-room-list']",
            "nav[aria-label*='chat' i]",
        ].join(","));

        let bestMatch = null;

        for (const container of preferredContainers) {
            const items = getChatItems(container);

            if (!bestMatch || items.length > bestMatch.items.length) {
                bestMatch = {
                    container,
                    items,
                    strategy: describeElement(container),
                };
            }
        }

        if (bestMatch?.items.length) {
            return bestMatch;
        }

        const globalItems = getChatItems(document);

        if (!globalItems.length) {
            return null;
        }

        const firstItemRoot = globalItems[0].getRootNode?.();
        const container = firstItemRoot instanceof ShadowRoot
            ? firstItemRoot
            : (globalItems[0].parentElement || document);

        return {
            container,
            items: getChatItems(container).length
                ? getChatItems(container)
                : globalItems,
            strategy: `${describeElement(container)} (room-link fallback)`,
        };
    }

    function getChatName(chatItem) {
        if (!chatItem) {
            return "Unknown";
        }

        try {
            const link = getChatLink(chatItem);
            const accessibleName = normalizeText(
                link?.getAttribute("aria-label")
                || link?.getAttribute("title")
                || chatItem.getAttribute?.("aria-label")
                || chatItem.getAttribute?.("title")
            );

            if (accessibleName) {
                return accessibleName;
            }

            const possibleNames = deepQueryAll([
                ".room-name",
                "[class*='room-name']",
                "[data-testid*='room-name']",
                "[slot='name']",
            ].join(","), chatItem);

            for (const element of possibleNames) {
                const text = normalizeText(element.textContent);

                if (text) {
                    return text;
                }
            }

            const linkText = normalizeText(link?.textContent);

            if (linkText && linkText.length <= 120) {
                return linkText;
            }
        } catch (error) {
            console.debug(
                "[Reddit Hide Old Chats] Could not determine chat name:",
                error
            );
        }

        return getRoomId(chatItem) || "Unknown";
    }

    function isModmailChat(chatItem) {
        if (!chatItem) {
            return false;
        }

        return Boolean(
            deepQuery(
                'rs-channel-icon[channeltype="reddit_modmail"]'
                + ", .text-global-moderator",
                chatItem
            )
        );
    }

    function isChatActive(chatItem) {
        if (!chatItem) {
            return false;
        }

        return chatItem.hasAttribute("selected")
            && chatItem.getAttribute("tabindex") === "0";
    }

    function findActiveChatItem(roomId) {
        const normalizedRoomId = normalizeRoomId(roomId);

        if (!normalizedRoomId) {
            return null;
        }

        const activeItems = deepQueryAll(CHAT_ITEM_SELECTOR)
            .filter(isChatActive);

        return activeItems.find((item) => (
            getRoomId(item) === normalizedRoomId
        )) || null;
    }

    function getCurrentRoomId() {
        return roomIdFromHref(location.href);
    }

    function activateChatItem(chatItem, link, useKeyboard = false) {
        const activationTarget = link?.isConnected ? link : chatItem;

        if (!activationTarget?.isConnected) {
            return false;
        }

        if (useKeyboard && chatItem?.isConnected) {
            chatItem.focus?.({ preventScroll: true });

            for (const type of ["keydown", "keyup"]) {
                chatItem.dispatchEvent(new KeyboardEvent(type, {
                    key: "Enter",
                    code: "Enter",
                    bubbles: true,
                    composed: true,
                }));
            }
        }

        activationTarget.click();
        return true;
    }

    async function openChat(chatItem, chatName = "Chat") {
        let liveItem = chatItem;
        let link = getChatLink(liveItem);
        const linkRoomId = roomIdFromHref(link?.href);
        const targetRoomId = linkRoomId || getRoomId(liveItem);
        const canActivate = Boolean(link?.isConnected || liveItem?.isConnected);

        if (!canActivate || !targetRoomId) {
            return {
                success: false,
                reason: !canActivate
                    ? "The conversation row is no longer attached to the page."
                    : "The conversation row did not provide a usable room ID.",
                details: {
                    linkFound: Boolean(link),
                    targetRoomIdFound: Boolean(targetRoomId),
                    itemConnected: Boolean(liveItem?.isConnected),
                    item: describeElement(liveItem),
                },
            };
        }

        const initialRoomId = getCurrentRoomId();
        const started = Date.now();
        let routeMatchStarted = initialRoomId === targetRoomId
            ? started
            : null;
        let routeChanged = false;
        let targetRouteMatched = initialRoomId === targetRoomId;
        let activeMatchStarted = null;
        let activeRowMatched = false;
        let roomSeen = false;
        let maxTimelineEvents = 0;
        let retryUsed = false;

        activateChatItem(liveItem, link);

        while (Date.now() - started < CONFIG.chatOpenTimeoutMs) {
            if (state.stopRequested) {
                return {
                    success: false,
                    stopped: true,
                    reason: "Navigation stopped by user.",
                };
            }

            const elapsed = Date.now() - started;
            const currentRoomId = getCurrentRoomId();
            const isTargetRoom = currentRoomId === targetRoomId;
            const currentActiveItem = findActiveChatItem(targetRoomId);
            const isTargetActive = Boolean(currentActiveItem);

            if (currentActiveItem) {
                liveItem = currentActiveItem;
                link = getChatLink(liveItem) || link;
            }

            routeChanged ||= currentRoomId !== initialRoomId;
            targetRouteMatched ||= isTargetRoom;
            activeRowMatched ||= isTargetActive;

            if (isTargetActive && activeMatchStarted === null) {
                activeMatchStarted = Date.now();
            } else if (!isTargetActive) {
                activeMatchStarted = null;
            }

            if (isTargetRoom && routeMatchStarted === null) {
                routeMatchStarted = Date.now();
            } else if (!isTargetRoom) {
                routeMatchStarted = null;
            }

            if (isTargetRoom || isTargetActive) {
                const events = getCurrentTimelineEvents();
                const room = findMainChatContainer();
                const routeStableFor = routeMatchStarted === null
                    ? 0
                    : Date.now() - routeMatchStarted;
                const activeStableFor = activeMatchStarted === null
                    ? 0
                    : Date.now() - activeMatchStarted;

                maxTimelineEvents = Math.max(
                    maxTimelineEvents,
                    events.length
                );
                roomSeen ||= Boolean(room);

                if (
                    activeStableFor >= CONFIG.chatOpenDelayMs
                    && events.length > 0
                ) {
                    return {
                        success: true,
                        readiness: "active room row and timeline events",
                    };
                }

                if (
                    activeStableFor >= CONFIG.chatOpenDelayMs
                    && room
                ) {
                    return {
                        success: true,
                        readiness: "active room row and message view",
                    };
                }

                /*
                 * The row's selected + tabindex=0 state is Reddit's own
                 * authoritative activation signal. The timestamp reader
                 * performs a separate guarded wait for virtualized messages.
                 */
                if (activeStableFor >= CONFIG.routeOnlyReadyMs) {
                    return {
                        success: true,
                        readiness: "stable active room row",
                    };
                }

                if (
                    routeStableFor >= CONFIG.chatOpenDelayMs
                    && events.length > 0
                ) {
                    return {
                        success: true,
                        readiness: "target route and timeline events",
                    };
                }

                if (
                    routeStableFor >= CONFIG.chatOpenDelayMs
                    && room
                ) {
                    return {
                        success: true,
                        readiness: "target route and room view",
                    };
                }

                /*
                 * Some Reddit layouts expose neither rs-room nor visible
                 * timeline hosts. A stable matching route is still enough to
                 * let the timestamp reader perform its own guarded wait.
                 */
                if (routeStableFor >= CONFIG.routeOnlyReadyMs) {
                    return {
                        success: true,
                        readiness: "stable target route",
                    };
                }
            }

            if (!retryUsed && elapsed >= CONFIG.chatOpenRetryMs) {
                retryUsed = true;
                log(
                    `${chatName}: Reddit has not activated the room yet; `
                    + "retrying with keyboard activation.",
                    "debug"
                );

                liveItem = findActiveChatItem(targetRoomId)
                    || getChatItems(document).find((item) => (
                        getRoomId(item) === targetRoomId
                    ))
                    || liveItem;
                link = getChatLink(liveItem) || link;
                activateChatItem(liveItem, link, true);
            }

            await sleep(CONFIG.messagePollMs);
        }

        const currentRoomId = getCurrentRoomId();

        return {
            success: false,
            reason: activeRowMatched
                ? "The requested row became active, but its message view never became ready."
                : (targetRouteMatched
                    ? "Reddit switched routes but the room view never became ready."
                    : "Reddit did not activate the requested room."),
            details: {
                targetSource: linkRoomId ? "room link" : "room attribute",
                activationTarget: link?.isConnected
                    ? "room link"
                    : "room component",
                startedOnTarget: initialRoomId === targetRoomId,
                routeChanged,
                targetRouteMatched,
                endedOnTarget: currentRoomId === targetRoomId,
                activeRowMatched,
                roomSeen,
                maxTimelineEvents,
                retryUsed,
                itemConnected: Boolean(liveItem?.isConnected),
                linkConnected: Boolean(link?.isConnected),
                elapsedMs: Date.now() - started,
                currentRoute: redactedChatPath(),
            },
        };
    }

    function isInReplyThread(element) {
        return Boolean(composedClosest(element, "rs-thread-timeline"));
    }

    function findBestTimelineContainer(event) {
        let current = event;
        let best = event;
        let bestCount = 1;

        for (let depth = 0; depth < 12 && current; depth += 1) {
            const count = deepQueryAll("rs-timeline-event", current).length;

            if (count > bestCount) {
                best = current;
                bestCount = count;
            }

            current = composedParent(current);
        }

        return best;
    }

    function findMainChatContainer() {
        const timelineEvents = deepQueryAll("rs-timeline-event")
            .filter((event) => !isInReplyThread(event));

        if (timelineEvents.length > 0) {
            const event = timelineEvents.find(
                isVisibleOrContainsVisibleContent
            ) || timelineEvents[0];

            return findBestTimelineContainer(event);
        }

        for (const selector of [
            "rs-virtual-scroll-dynamic",
            "rs-room-messages",
            "rs-room",
            "main, article, [role='main']",
        ]) {
            const candidates = deepQueryAll(selector);
            const candidate = candidates.find(
                isVisibleOrContainsVisibleContent
            ) || candidates[0];

            if (candidate) {
                return candidate;
            }
        }

        return null;
    }

    function getCurrentTimelineEvents() {
        const room = findMainChatContainer();

        if (room) {
            const events = deepQueryAll("rs-timeline-event", room)
                .filter((event) => !isInReplyThread(event));

            if (events.length > 0) {
                return events.filter(isVisibleOrContainsVisibleContent);
            }
        }

        return deepQueryAll("rs-timeline-event")
            .filter((event) => !isInReplyThread(event))
            .filter(isVisibleOrContainsVisibleContent);
    }

    function normalizeTimestamp(value) {
        if (value === null || value === undefined) {
            return null;
        }

        if (value instanceof Date) {
            const timestamp = value.getTime();

            return Number.isFinite(timestamp) ? timestamp : null;
        }

        if (typeof value === "number") {
            let timestamp = value;

            // Unix timestamps may be expressed in seconds.
            if (timestamp > 1_000_000_000 && timestamp < 10_000_000_000) {
                timestamp *= 1000;
            }

            if (
                timestamp > 946684800000
                && timestamp < 4102444800000
            ) {
                return timestamp;
            }

            return null;
        }

        const stringValue = normalizeText(value);

        if (!stringValue) {
            return null;
        }

        if (/^\d{10,13}$/.test(stringValue)) {
            return normalizeTimestamp(Number(stringValue));
        }

        /*
         * Only allow strings that clearly look date-related. This avoids
         * accidentally parsing dates somebody wrote inside a chat message.
         */
        const looksLikeDate = (
            /\d{4}-\d{1,2}-\d{1,2}/.test(stringValue)
            || /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(stringValue)
            || /^\s*\d{1,2}[/-]\d{1,2}\s*$/.test(stringValue)
            || /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i.test(
                stringValue
            )
            || /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\b/i.test(
                stringValue
            )
        );

        if (!looksLikeDate) {
            return null;
        }

        /*
         * Sidebar dates commonly omit the year ("August 20" or "8/20").
         * Resolve those before Date.parse so a December date viewed in August
         * is correctly understood as last year rather than next December.
         */
        if (!/\b(?:19|20)\d{2}\b/.test(stringValue)) {
            const namedMonthDay = stringValue.match(
                /^\s*(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\s*$/i
            );
            const numericMonthDay = stringValue.match(
                /^\s*(\d{1,2})[/-](\d{1,2})\s*$/
            );

            if (namedMonthDay || numericMonthDay) {
                const now = new Date();
                const dateText = namedMonthDay
                    ? `${namedMonthDay[1]} ${namedMonthDay[2]}`
                    : `${numericMonthDay[1]}/${numericMonthDay[2]}`;
                const candidate = new Date(
                    `${dateText}/${now.getFullYear()}`
                );

                if (!Number.isNaN(candidate.getTime())) {
                    if (
                        candidate.getTime()
                        > now.getTime() + (24 * 60 * 60 * 1000)
                    ) {
                        candidate.setFullYear(candidate.getFullYear() - 1);
                    }

                    return candidate.getTime();
                }
            }
        }

        const parsed = Date.parse(stringValue);

        if (Number.isFinite(parsed)) {
            return parsed;
        }

        return null;
    }

    function extractTimestampFromObject(object) {
        if (!object || typeof object !== "object") {
            return null;
        }

        const candidates = [
            object.origin_server_ts,
            object.timestamp,
            object.time,
            object.createdAt,
            object.created_at,
            object.sentAt,
            object.sent_at,
            object.date,
            object.event?.origin_server_ts,
            object.event?.timestamp,
            object.event?.time,
            object.data?.origin_server_ts,
            object.data?.timestamp,
            object.message?.origin_server_ts,
            object.message?.timestamp,
        ];

        for (const candidate of candidates) {
            const timestamp = normalizeTimestamp(candidate);

            if (timestamp !== null) {
                return timestamp;
            }
        }

        return null;
    }

    function extractTimestampFromElementAttributes(element) {
        if (!element) {
            return null;
        }

        const attributeNames = [
            "datetime",
            "timestamp",
            "data-timestamp",
            "data-time",
            "data-date",
            "title",
            "aria-label",
        ];

        for (const name of attributeNames) {
            const value = element.getAttribute?.(name);

            if (!value) {
                continue;
            }

            const timestamp = normalizeTimestamp(value);

            if (timestamp !== null) {
                return timestamp;
            }
        }

        return null;
    }

    function extractTimestampFromTimelineEvent(eventElement) {
        if (!eventElement) {
            return null;
        }

        /*
         * First check properties commonly used by Reddit's Matrix-based
         * chat components.
         */
        const directObjects = [
            eventElement,
            eventElement.event,
            eventElement._event,
            eventElement.data,
            eventElement.message,
            eventElement.timelineEvent,
            eventElement.matrixEvent,
        ];

        for (const object of directObjects) {
            const timestamp = extractTimestampFromObject(object);

            if (timestamp !== null) {
                return timestamp;
            }
        }

        const eventAttributeTimestamp =
            extractTimestampFromElementAttributes(eventElement);

        if (eventAttributeTimestamp !== null) {
            return eventAttributeTimestamp;
        }

        const root = eventElement.shadowRoot || eventElement;

        /*
         * Explicit timestamp elements are the safest DOM source.
         */
        const timestampElements = deepQueryAll(
            "time, [datetime], [timestamp], [data-timestamp], "
            + "[data-time], [data-date]",
            root
        );

        for (const element of timestampElements) {
            const timestamp =
                extractTimestampFromElementAttributes(element);

            if (timestamp !== null) {
                return timestamp;
            }

            const textTimestamp = normalizeTimestamp(element.textContent);

            if (textTimestamp !== null) {
                return textTimestamp;
            }
        }

        /*
         * Secondary fallback for elements whose class indicates that they
         * represent a date or timestamp.
         */
        const labeledTimeElements = deepQueryAll(
            "[class*='timestamp'], [class*='time-stamp'], "
            + "[class*='event-time'], [class*='message-time'], "
            + "[class*='event-date'], [class*='message-date']",
            root
        );

        for (const element of labeledTimeElements) {
            const attributeTimestamp =
                extractTimestampFromElementAttributes(element);

            if (attributeTimestamp !== null) {
                return attributeTimestamp;
            }

            const textTimestamp = normalizeTimestamp(element.textContent);

            if (textTimestamp !== null) {
                return textTimestamp;
            }
        }

        return null;
    }

    function timestampPrecisionMs(value) {
        if (value instanceof Date || typeof value === "number") {
            return 0;
        }

        const text = normalizeText(value);

        if (
            /^\d{10,13}$/.test(text)
            || /T\d{1,2}:\d{2}/i.test(text)
            || /\b\d{1,2}:\d{2}(?::\d{2})?\b/.test(text)
        ) {
            return 0;
        }

        /* A date without a time represents an unknown point in that day. */
        return 24 * 60 * 60 * 1000;
    }

    function extractTimestampFromChatListItem(chatItem) {
        if (!chatItem) {
            return null;
        }

        const results = [];
        const addResult = (value, source) => {
            const timestamp = normalizeTimestamp(value);

            if (
                timestamp === null
                || timestamp > Date.now() + (24 * 60 * 60 * 1000)
            ) {
                return;
            }

            results.push({
                timestamp,
                precisionMs: timestampPrecisionMs(value),
                source,
            });
        };

        /* Some builds expose the latest Matrix event as a component property. */
        for (const property of [
            "lastMessage",
            "latestMessage",
            "lastEvent",
            "latestEvent",
        ]) {
            try {
                const object = chatItem[property];
                const timestamp = extractTimestampFromObject(object);

                if (timestamp !== null) {
                    addResult(timestamp, `room component ${property}`);
                }
            } catch (error) {
                console.debug(
                    `[Reddit Hide Old Chats] Could not read ${property}:`,
                    error
                );
            }
        }

        const timestampSelector = [
            "time",
            "[datetime]",
            "[timestamp]",
            "[data-timestamp]",
            "[data-time]",
            "[data-date]",
            "[class*='timestamp']",
            "[class*='time-stamp']",
            "[class*='last-message-time']",
            "[class*='last-message-date']",
            "[class*='room-time']",
            "[class*='room-date']",
            "[data-testid*='timestamp']",
            "[data-testid*='last-message-time']",
            "[slot='timestamp']",
            "[slot='time']",
        ].join(",");
        const elements = [chatItem, ...deepQueryAll(
            timestampSelector,
            chatItem
        )];
        const attributeNames = [
            "datetime",
            "timestamp",
            "data-timestamp",
            "data-time",
            "data-date",
            "title",
            "aria-label",
        ];

        for (const element of elements) {
            for (const attribute of attributeNames) {
                const value = element.getAttribute?.(attribute);

                if (value) {
                    addResult(
                        value,
                        `${describeElement(element)}[${attribute}]`
                    );
                }
            }

            if (element !== chatItem) {
                addResult(
                    element.textContent,
                    `${describeElement(element)} text`
                );
            }
        }

        results.sort((a, b) => b.timestamp - a.timestamp);

        return results[0] || null;
    }

    function sidebarTimestampIsDecisive(result, days) {
        if (!result) {
            return false;
        }

        const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);

        return Math.abs(result.timestamp - cutoff) > result.precisionMs;
    }

    async function getLatestMessageTimestamp() {
        const started = Date.now();

        while (Date.now() - started < CONFIG.messageLoadTimeoutMs) {
            const events = getCurrentTimelineEvents();

            if (events.length > 0) {
                const timestamps = events
                    .map(extractTimestampFromTimelineEvent)
                    .filter((value) => value !== null);

                if (timestamps.length > 0) {
                    return Math.max(...timestamps);
                }
            }

            if (state.stopRequested) {
                return null;
            }

            await sleep(CONFIG.messagePollMs);
        }

        return null;
    }

    function formatDate(timestamp) {
        return new Date(timestamp).toLocaleString();
    }

    function ageInDays(timestamp) {
        return (Date.now() - timestamp) / (24 * 60 * 60 * 1000);
    }

    function findVisibleSettingsButton() {
        const components = deepQueryAll("rs-room-settings-button");

        for (const component of components) {
            if (!component.shadowRoot) {
                continue;
            }

            const button = component.shadowRoot.querySelector("button");

            if (button && isVisible(button)) {
                return button;
            }
        }

        return null;
    }

    function findExactTextElement(pattern) {
        const selectors = [
            "button",
            "[role='menuitem']",
            "li",
            "faceplate-menu-item",
            "div",
            "span",
        ].join(",");

        const candidates = deepQueryAll(selectors)
            .filter(isVisible)
            .filter((element) => pattern.test(normalizeText(element.textContent)))
            .sort((a, b) => {
                const aLength = normalizeText(a.textContent).length;
                const bLength = normalizeText(b.textContent).length;

                return aLength - bLength;
            });

        return candidates[0] || null;
    }

    async function findHideChatOption() {
        const started = Date.now();

        while (Date.now() - started < 3000) {
            const exact = findExactTextElement(/^hide chat$/i);

            if (exact) {
                const actionSelector = "button, [role='button'], "
                    + "[role='menuitem'], faceplate-menu-item";
                const nestedAction = deepQueryAll(
                    actionSelector,
                    exact
                ).find((element) => (
                    /^hide chat$/i.test(normalizeText(element.textContent))
                ));

                return (exact.matches?.(actionSelector) ? exact : null)
                    || nestedAction
                    || composedClosest(
                        exact,
                        actionSelector
                    )
                    || exact;
            }

            await sleep(100);
        }

        return null;
    }

    function findHideConfirmationButton() {
        const dialogs = deepQueryAll([
            "#rs-confirmation-modal-dialog",
            "rpl-dialog",
            "[role='dialog']",
        ].join(",")).filter(isVisibleOrContainsVisibleContent);

        for (const dialog of dialogs) {
            const scopes = new Set([dialog]);

            if (dialog.shadowRoot) {
                scopes.add(dialog.shadowRoot);
            }

            /*
             * Reddit slots rs-rpl-dialog-content into the confirmation host.
             * querySelector cannot cross that assignment, so explicitly add
             * every flattened slot element as a search scope.
             */
            for (const slot of deepQueryAll("slot", dialog)) {
                try {
                    for (const assigned of slot.assignedElements({
                        flatten: true,
                    })) {
                        scopes.add(assigned);
                    }
                } catch (error) {
                    console.debug(
                        "[Reddit Hide Old Chats] Could not inspect a dialog slot:",
                        error
                    );
                }
            }

            for (const content of deepQueryAll(
                "rs-rpl-dialog-content",
                dialog
            )) {
                scopes.add(content);
            }

            const actions = new Set();

            for (const scope of scopes) {
                if (
                    scope.matches?.("button, [role='button']")
                    && isVisible(scope)
                ) {
                    actions.add(scope);
                }

                for (const action of deepQueryAll(
                    "button, [role='button']",
                    scope
                )) {
                    if (isVisible(action)) {
                        actions.add(action);
                    }
                }
            }

            for (const action of actions) {
                const label = normalizeText(
                    action.getAttribute?.("aria-label")
                    || action.getAttribute?.("title")
                    || action.textContent
                );

                if (/^(?:yes,\s*)?hide(?: chat| conversation)?$/i.test(label)) {
                    return action;
                }
            }

            const context = [...scopes]
                .flatMap((scope) => deepQueryAll("*", scope))
                .map((element) => normalizeText(element.textContent))
                .filter(Boolean)
                .join(" ");

            if (!/hide (?:this )?(?:chat|conversation)/i.test(context)) {
                continue;
            }

            const primaryActions = [...actions].filter((action) => (
                action.matches?.("button.button-primary, button[type='submit']")
            ));

            if (primaryActions.length === 1) {
                return primaryActions[0];
            }
        }

        return null;
    }

    async function waitForHideConfirmationButton() {
        const started = Date.now();

        while (Date.now() - started < 5000) {
            const button = findHideConfirmationButton();

            if (button) {
                return button;
            }

            await sleep(100);
        }

        return null;
    }

    async function hideCurrentChat() {
        const settingsButton = findVisibleSettingsButton();

        if (!settingsButton) {
            return {
                success: false,
                reason: "Could not find the chat settings button.",
            };
        }

        settingsButton.click();
        await sleep(CONFIG.settingsOpenDelayMs);

        const hideOption = await findHideChatOption();

        if (!hideOption) {
            return {
                success: false,
                reason: "Could not find an action explicitly labeled "
                    + "Hide chat. No action was taken.",
            };
        }

        hideOption.click();
        await sleep(CONFIG.confirmationDelayMs);

        const confirmationButton =
            await waitForHideConfirmationButton();

        if (!confirmationButton) {
            return {
                success: false,
                reason: "Could not find the Hide chat confirmation button.",
            };
        }

        confirmationButton.click();
        await sleep(CONFIG.postHideDelayMs);

        return {
            success: true,
            reason: null,
        };
    }

    function getCurrentlyActiveChatItem() {
        const activeItems = deepQueryAll(CHAT_ITEM_SELECTOR)
            .filter(isChatActive);
        const routeRoomId = getCurrentRoomId();

        if (routeRoomId) {
            const routeMatch = activeItems.find((item) => (
                getRoomId(item) === routeRoomId
            ));

            if (routeMatch) {
                return routeMatch;
            }
        }

        return activeItems[0] || null;
    }

    async function hideCurrentlyActiveChatManually() {
        if (state.running) {
            return;
        }

        const activeItem = getCurrentlyActiveChatItem();
        const roomId = getRoomId(activeItem) || getCurrentRoomId();
        const chatName = activeItem
            ? getChatName(activeItem)
            : "the current conversation";

        if (!activeItem && !roomId) {
            setUiStatus(
                "error",
                "No active chat",
                "Open a conversation before using Hide current"
            );
            log(
                "Quick hide could not identify the currently active chat. "
                + "Nothing was changed.",
                "error"
            );
            return;
        }

        const confirmed = window.confirm(
            `Hide ${chatName}?\n\n`
            + "This runs Reddit's Hide chat action. Messages will not be "
            + "deleted."
        );

        if (!confirmed) {
            setUiStatus(
                "warning",
                "Quick hide cancelled",
                "The current chat was not changed"
            );
            log(
                `${chatName}: quick hide cancelled. Nothing was hidden or `
                + "deleted.",
                "warning"
            );
            return;
        }

        const runButton = document.getElementById("rhoc-run");
        const stopButton = document.getElementById("rhoc-stop");
        const quickHideButton = document.getElementById("rhoc-hide-current");
        const daysInput = document.getElementById("rhoc-days");
        const modeToggle = document.getElementById("rhoc-send-it");

        state.running = true;
        state.stopRequested = false;
        state.currentChatName = chatName;
        runButton.disabled = true;
        stopButton.disabled = true;
        quickHideButton.disabled = true;
        daysInput.disabled = true;
        modeToggle.disabled = true;
        renderCandidateList();
        setUiStatus(
            "running",
            "Hiding current chat",
            `${chatName} · messages are not deleted`
        );
        log(`${chatName}: starting confirmed quick hide.`);

        try {
            const result = await hideCurrentChat();

            if (!result.success) {
                state.stats.errors += 1;
                updateStatsDisplay();
                setUiStatus(
                    "error",
                    "Quick hide failed",
                    result.reason
                );
                log(
                    `${chatName}: ${result.reason} Nothing was deleted.`,
                    "error"
                );
                return;
            }

            const candidate = roomId ? state.candidates.get(roomId) : null;

            if (candidate) {
                candidate.status = "hidden";
                candidate.selected = false;
            }

            state.stats.hidden += 1;
            updateStatsDisplay();
            setUiStatus(
                "success",
                "Current chat hidden",
                `${chatName} · no messages deleted`
            );
            log(
                `${chatName}: hidden with Quick hide. Messages were not `
                + "deleted.",
                "success"
            );
        } catch (error) {
            state.stats.errors += 1;
            updateStatsDisplay();
            setUiStatus(
                "error",
                "Quick hide failed",
                "Nothing was deleted"
            );
            log(
                `${chatName}: ${error.message || String(error)} Nothing was `
                + "deleted.",
                "error"
            );
        } finally {
            state.running = false;
            state.currentChatName = null;
            runButton.disabled = false;
            stopButton.disabled = true;
            quickHideButton.disabled = false;
            daysInput.disabled = false;
            modeToggle.disabled = false;
            renderCandidateList();
            updateReviewControls();
            syncWorkflowModeUi();
        }
    }

    function getScrollableChatList(container) {
        if (!container) {
            return null;
        }

        const candidateSet = new Set();
        const addCandidate = (candidate) => {
            if (candidate instanceof HTMLElement) {
                candidateSet.add(candidate);
            }
        };

        addCandidate(container);

        for (const candidate of deepQueryAll([
            "div",
            "nav",
            "section",
            "rs-virtual-scroll-dynamic",
            "faceplate-tracker",
            "[role='list']",
        ].join(","), container)) {
            addCandidate(candidate);
        }

        /* The scrolling viewport may sit above a shadow host. */
        for (const item of getChatItems(container).slice(0, 12)) {
            let current = item;

            for (let depth = 0; depth < 16 && current; depth += 1) {
                addCandidate(current);
                current = composedParent(current);
            }
        }

        let best = null;
        let bestScore = 0;

        for (const candidate of candidateSet) {
            const scrollableAmount =
                candidate.scrollHeight - candidate.clientHeight;
            const overflowY = window.getComputedStyle(candidate).overflowY;
            const explicitlyScrollable = /^(auto|scroll|overlay)$/.test(
                overflowY
            );
            const score = scrollableAmount
                + (explicitlyScrollable ? 1_000_000 : 0);

            if (
                scrollableAmount > 10
                && candidate.clientHeight > 100
                && score > bestScore
            ) {
                best = candidate;
                bestScore = score;
            }
        }

        return best;
    }

    function updateStatsDisplay() {
        const element = document.getElementById("rhoc-stats");

        if (!element) {
            return;
        }

        const statElements = element.querySelectorAll("[data-rhoc-stat]");

        if (statElements.length) {
            for (const statElement of statElements) {
                const key = statElement.dataset.rhocStat;

                statElement.textContent = String(state.stats[key] || 0);
            }

            return;
        }

        element.textContent = [
            `Checked: ${state.stats.checked}`,
            `Old: ${state.stats.old}`,
            `Hidden: ${state.stats.hidden}`,
            `Skipped: ${state.stats.skipped}`,
            `Errors: ${state.stats.errors}`,
        ].join(" | ");
    }

    function getSelectedCandidates() {
        return [...state.candidates.values()].filter((candidate) => (
            candidate.selected
            && (candidate.status === "ready" || candidate.status === "error")
        ));
    }

    function updateReviewControls() {
        const total = state.candidates.size;
        const selected = getSelectedCandidates().length;
        const count = document.getElementById("rhoc-review-tab-count");
        const summary = document.getElementById("rhoc-selection-summary");
        const hideButton = document.getElementById("rhoc-hide-selected");
        const selectAllButton = document.getElementById("rhoc-select-all");
        const selectNoneButton = document.getElementById("rhoc-select-none");

        if (count) {
            count.textContent = String(total);
        }

        if (summary) {
            summary.textContent = total
                ? `${selected} of ${total} selected`
                : "No candidates yet";
        }

        if (hideButton) {
            hideButton.disabled = state.running || selected === 0;
            hideButton.textContent = selected
                ? `Hide ${selected} selected`
                : "Hide selected";
        }

        if (selectAllButton) {
            selectAllButton.disabled = state.running || total === 0;
        }

        if (selectNoneButton) {
            selectNoneButton.disabled = state.running || selected === 0;
        }
    }

    function renderCandidateList() {
        const list = document.getElementById("rhoc-candidate-list");

        if (!list) {
            return;
        }

        const previousScrollTop = list.scrollTop;

        list.replaceChildren();

        const candidates = [...state.candidates.values()].sort(
            (a, b) => b.age - a.age
        );

        if (!candidates.length) {
            const empty = document.createElement("div");

            empty.className = "rhoc-candidate-empty";
            empty.textContent = "Run a scan to build a review list. The scan "
                + "does not change or hide anything.";
            list.appendChild(empty);
            updateReviewControls();
            return;
        }

        for (const candidate of candidates) {
            const row = document.createElement("label");
            const checkbox = document.createElement("input");
            const copy = document.createElement("span");
            const name = document.createElement("span");
            const meta = document.createElement("span");
            const badge = document.createElement("span");

            row.className = "rhoc-candidate-row";
            row.dataset.status = candidate.status;
            row.dataset.selected = String(candidate.selected);

            checkbox.type = "checkbox";
            checkbox.checked = candidate.selected;
            checkbox.disabled = state.running
                || candidate.status === "hidden"
                || candidate.status === "hiding";
            checkbox.setAttribute(
                "aria-label",
                `Select ${candidate.name} for hiding`
            );
            checkbox.addEventListener("change", () => {
                candidate.selected = checkbox.checked;
                renderCandidateList();
            });

            copy.className = "rhoc-candidate-copy";
            name.className = "rhoc-candidate-name";
            meta.className = "rhoc-candidate-meta";
            badge.className = "rhoc-candidate-badge";

            name.textContent = candidate.name;
            meta.textContent = `${candidate.age.toFixed(1)} days old · newest `
                + `${formatDate(candidate.latestTimestamp)} · `
                + (candidate.dateSource === "sidebar"
                    ? "sidebar date"
                    : "verified in chat");
            badge.textContent = {
                ready: candidate.selected ? "Will hide" : "Excluded",
                hiding: "Hiding…",
                hidden: "Hidden",
                error: candidate.selected ? "Retry" : "Excluded",
            }[candidate.status] || candidate.status;

            copy.append(name, meta);
            row.append(checkbox, copy, badge);
            list.appendChild(row);
        }

        list.scrollTop = previousScrollTop;
        updateReviewControls();
    }

    function setCandidateSelection(selected) {
        for (const candidate of state.candidates.values()) {
            if (candidate.status === "ready" || candidate.status === "error") {
                candidate.selected = selected;
            }
        }

        renderCandidateList();
    }

    function setActiveTab(tabName) {
        const tabs = document.querySelectorAll("[data-rhoc-tab]");
        const panels = document.querySelectorAll("[data-rhoc-tab-panel]");

        for (const tab of tabs) {
            const active = tab.dataset.rhocTab === tabName;

            tab.classList.toggle("rhoc-active", active);
            tab.setAttribute("aria-selected", String(active));
        }

        for (const panel of panels) {
            panel.hidden = panel.dataset.rhocTabPanel !== tabName;
        }
    }

    function addCandidate(candidate) {
        state.candidates.set(candidate.roomId, {
            ...candidate,
            selected: true,
            status: "ready",
        });
        renderCandidateList();
    }

    function setUiStatus(kind, label, detail = "") {
        const panel = document.getElementById("rhoc-panel");
        const status = document.getElementById("rhoc-status");
        const statusLabel = document.getElementById("rhoc-status-label");
        const statusDetail = document.getElementById("rhoc-status-detail");

        if (panel) {
            panel.dataset.status = kind;
        }

        if (status) {
            status.dataset.status = kind;
        }

        if (statusLabel) {
            statusLabel.textContent = label;
        }

        if (statusDetail) {
            statusDetail.textContent = detail;
        }
    }

    function syncWorkflowModeUi() {
        const toggle = document.getElementById("rhoc-send-it");
        const card = document.getElementById("rhoc-mode-card");
        const title = document.getElementById("rhoc-mode-title");
        const description = document.getElementById(
            "rhoc-mode-description"
        );
        const runButton = document.getElementById("rhoc-run");

        if (!toggle) {
            return;
        }

        const sendIt = toggle.checked;

        if (card) {
            card.dataset.mode = sendIt ? "send" : "confirm";
        }

        if (title) {
            title.textContent = sendIt ? "Send it" : "Scan then confirm";
        }

        if (description) {
            description.textContent = sendIt
                ? "Hide old chats immediately as found"
                : "Review all matches before hiding";
        }

        if (runButton && !state.running) {
            runButton.textContent = sendIt
                ? "Send it"
                : "Scan then confirm";
        }
    }

    function redactedChatPath() {
        return location.pathname.replace(
            /^(\/chat\/room\/)[^/]+/i,
            "$1<room-id>"
        );
    }

    function collectDomDiagnostics() {
        const allElements = deepQueryAll("*");
        const shadowRoots = new Set();
        const relevantCustomTags = new Set();

        for (const element of allElements) {
            const root = element.getRootNode?.();
            const tag = element.tagName?.toLowerCase();

            if (root instanceof ShadowRoot) {
                shadowRoots.add(root);
            }

            if (
                tag
                && /^(rs-|faceplate-)/.test(tag)
                && /(room|chat|nav|timeline|virtual|roving)/.test(tag)
            ) {
                relevantCustomTags.add(tag);
            }
        }

        const located = locateChatList();
        const scrollElement = located
            ? getScrollableChatList(located.container)
            : null;

        return {
            scriptVersion: CONFIG.version,
            route: redactedChatPath(),
            readyState: document.readyState,
            viewport: `${window.innerWidth}x${window.innerHeight}`,
            shadowRoots: shadowRoots.size,
            rovingWrappers: deepQueryAll("rs-roving-focus-wrapper").length,
            rovingNative: deepQueryAll("rs-roving-focus-native").length,
            roomComponents: deepQueryAll("rs-rooms-nav-room").length,
            roomLinks: deepQueryAll(CHAT_LINK_SELECTOR).length,
            visibleRoomRows: getChatItems(document).length,
            visibleRooms: deepQueryAll("rs-room").filter(isVisible).length,
            visibleTimelineEvents: deepQueryAll("rs-timeline-event")
                .filter(isVisible).length,
            listStrategy: located?.strategy || "none",
            scrollElement: describeElement(scrollElement),
            customTags: [...relevantCustomTags].sort().slice(0, 30),
        };
    }

    function formatDiagnostics(diagnostics = collectDomDiagnostics()) {
        return Object.entries(diagnostics)
            .map(([key, value]) => {
                const formatted = Array.isArray(value)
                    ? (value.join(", ") || "none")
                    : String(value);

                return `${key}: ${formatted}`;
            })
            .join("\n");
    }

    function log(message, type = "info", details = null) {
        const logElement = document.getElementById("rhoc-log");
        const timestamp = new Date();

        const prefix = {
            info: "",
            debug: "DEBUG: ",
            success: "OK: ",
            warning: "WARN: ",
            error: "ERROR: ",
        }[type] || "";

        const consoleMethod = {
            debug: "debug",
            warning: "warn",
            error: "error",
        }[type] || "log";

        console[consoleMethod](
            `[Reddit Hide Old Chats] ${prefix}${message}`,
            details || ""
        );

        state.logRecords.push({
            timestamp: timestamp.toISOString(),
            type,
            message,
            details,
        });

        while (state.logRecords.length > CONFIG.maxLogEntries) {
            state.logRecords.shift();
        }

        if (!logElement) {
            return;
        }

        const line = document.createElement("div");
        const time = document.createElement("span");
        const marker = document.createElement("span");
        const content = document.createElement("span");

        line.className = `rhoc-log-entry rhoc-log-${type}`;
        time.className = "rhoc-log-time";
        marker.className = "rhoc-log-marker";
        content.className = "rhoc-log-message";

        time.textContent = timestamp.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
        });
        marker.textContent = {
            info: "•",
            debug: "·",
            success: "✓",
            warning: "!",
            error: "×",
        }[type] || "•";
        content.textContent = message;

        line.append(time, marker, content);

        if (details) {
            const disclosure = document.createElement("details");
            const summary = document.createElement("summary");
            const detailContent = document.createElement("pre");

            summary.textContent = "Details";
            detailContent.textContent = typeof details === "string"
                ? details
                : JSON.stringify(details, null, 2);
            disclosure.append(summary, detailContent);
            content.appendChild(disclosure);
        }

        logElement.appendChild(line);
        logElement.scrollTop = logElement.scrollHeight;

        while (logElement.children.length > CONFIG.maxLogEntries) {
            logElement.firstChild.remove();
        }
    }

    function clearLog() {
        state.logRecords = [];

        const logElement = document.getElementById("rhoc-log");

        if (logElement) {
            logElement.replaceChildren();
        }
    }

    async function copyLog() {
        const header = [
            `Reddit Hide Old Chats v${CONFIG.version}`,
            formatDiagnostics(),
            "",
            "Log:",
        ].join("\n");
        const lines = state.logRecords.map((record) => {
            const detail = record.details
                ? `\n${typeof record.details === "string"
                    ? record.details
                    : JSON.stringify(record.details, null, 2)}`
                : "";

            return `[${record.timestamp}] ${record.type.toUpperCase()} `
                + `${record.message}${detail}`;
        });
        const text = `${header}\n${lines.join("\n")}`;
        const button = document.getElementById("rhoc-copy-log");

        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(text);
            } else {
                const textarea = document.createElement("textarea");

                textarea.value = text;
                textarea.style.position = "fixed";
                textarea.style.opacity = "0";
                document.body.appendChild(textarea);
                textarea.select();

                const copied = document.execCommand("copy");

                textarea.remove();

                if (!copied) {
                    throw new Error("The browser rejected the copy command.");
                }
            }

            if (button) {
                button.textContent = "Copied";
                window.setTimeout(() => {
                    button.textContent = "Copy log";
                }, 1500);
            }
        } catch (error) {
            log(`Could not copy the log: ${error.message}`, "error");
        }
    }

    async function processChat(chatItem, days, { sendIt = false } = {}) {
        const roomId = getRoomId(chatItem);

        if (!roomId) {
            state.stats.skipped += 1;
            updateStatsDisplay();

            log("Skipping chat without a room ID.", "warning");
            return;
        }

        if (state.processedRoomIds.has(roomId)) {
            return;
        }

        /*
         * Mark it before navigation because the item may disappear if we
         * subsequently hide it.
         */
        state.processedRoomIds.add(roomId);

        const chatName = getChatName(chatItem);
        state.currentChatName = chatName;
        setUiStatus(
            "running",
            "Scanning",
            `Chat ${state.processedRoomIds.size}: ${chatName}`
        );

        if (isModmailChat(chatItem)) {
            state.stats.skipped += 1;
            updateStatsDisplay();

            log(`${chatName}: skipping Mod Mail chat.`, "warning");
            return;
        }

        const sidebarTimestamp = extractTimestampFromChatListItem(chatItem);
        const useSidebarTimestamp = sidebarTimestampIsDecisive(
            sidebarTimestamp,
            days
        );
        let latestTimestamp = null;
        let dateSource = "chat";
        let chatIsOpen = false;

        if (useSidebarTimestamp) {
            latestTimestamp = sidebarTimestamp.timestamp;
            dateSource = "sidebar";
            log(
                `${chatName}: using the conversation-list date; no need to `
                + "open this chat for scanning.",
                "debug",
                {
                    source: sidebarTimestamp.source,
                    date: new Date(latestTimestamp).toISOString(),
                }
            );
        } else {
            if (sidebarTimestamp) {
                log(
                    `${chatName}: sidebar date is too close to the ${days}-day `
                    + "cutoff, so the message view will be checked.",
                    "debug",
                    {
                        source: sidebarTimestamp.source,
                        date: new Date(
                            sidebarTimestamp.timestamp
                        ).toISOString(),
                    }
                );
            }

            log(`${chatName}: opening to read its latest message date...`);

            const openResult = await openChat(chatItem, chatName);

            if (!openResult.success) {
                if (openResult.stopped || state.stopRequested) {
                    return;
                }

                state.stats.errors += 1;
                updateStatsDisplay();

                log(
                    `${chatName}: ${openResult.reason}`,
                    "error",
                    openResult.details
                );
                return;
            }

            if (state.stopRequested) {
                return;
            }

            log(
                `${chatName}: opened via ${openResult.readiness
                    || "Reddit's active-room signal"}.`,
                "debug"
            );

            chatIsOpen = true;
            latestTimestamp = await getLatestMessageTimestamp();
        }

        state.stats.checked += 1;

        if (latestTimestamp === null) {
            state.stats.skipped += 1;
            updateStatsDisplay();

            log(
                `${chatName}: could not confidently determine the `
                + "most recent message date. Skipping.",
                "warning"
            );

            return;
        }

        const age = ageInDays(latestTimestamp);
        const ageDisplay = age.toFixed(1);

        if (age <= days) {
            updateStatsDisplay();

            log(
                `${chatName}: ${ageDisplay} days old `
                + `(${formatDate(latestTimestamp)}). Keeping.`
            );

            return;
        }

        state.stats.old += 1;
        updateStatsDisplay();

        addCandidate({
            roomId,
            name: chatName,
            age,
            latestTimestamp,
            dateSource,
        });

        if (!sendIt) {
            log(
                `${chatName}: ${ageDisplay} days old `
                + `(${formatDate(latestTimestamp)}). Added to review; `
                + "nothing was changed.",
                "success"
            );
            return;
        }

        const candidate = state.candidates.get(roomId);

        candidate.status = "hiding";
        renderCandidateList();
        setUiStatus(
            "running",
            "Send it running",
            `${chatName} · opening old chat to hide`
        );

        if (!chatIsOpen) {
            log(
                `${chatName}: ${ageDisplay} days old. Send it is opening it `
                + "for immediate hiding."
            );

            const openResult = await openChat(chatItem, chatName);

            if (!openResult.success) {
                candidate.status = "error";

                if (openResult.stopped || state.stopRequested) {
                    candidate.status = "ready";
                    renderCandidateList();
                    return;
                }

                state.stats.errors += 1;
                updateStatsDisplay();
                renderCandidateList();
                log(
                    `${chatName}: ${openResult.reason} It was not hidden.`,
                    "error",
                    openResult.details
                );
                return;
            }

            chatIsOpen = true;
        }

        if (state.stopRequested) {
            candidate.status = "ready";
            renderCandidateList();
            return;
        }

        setUiStatus(
            "running",
            "Send it running",
            `${chatName} · hiding now · messages are not deleted`
        );

        const hideResult = await hideCurrentChat();

        if (!hideResult.success) {
            candidate.status = "error";
            state.stats.errors += 1;
            updateStatsDisplay();
            renderCandidateList();
            log(
                `${chatName}: ${hideResult.reason} Nothing was deleted.`,
                "error"
            );
            return;
        }

        candidate.status = "hidden";
        candidate.selected = false;
        state.stats.hidden += 1;
        updateStatsDisplay();
        renderCandidateList();
        log(
            `${chatName}: hidden immediately by Send it. Messages were not `
            + "deleted.",
            "success"
        );
    }

    async function runCleanup({ sendIt = false } = {}) {
        if (state.running) {
            return false;
        }

        const daysInput = document.getElementById("rhoc-days");
        const runButton = document.getElementById("rhoc-run");
        const stopButton = document.getElementById("rhoc-stop");
        const quickHideButton = document.getElementById("rhoc-hide-current");
        const modeToggle = document.getElementById("rhoc-send-it");
        let scanCompleted = false;

        const days = Number.parseFloat(daysInput.value);

        if (!Number.isFinite(days) || days < 0) {
            setUiStatus(
                "error",
                "Invalid threshold",
                "Enter zero or a positive number of days"
            );
            log(
                "Enter zero or a positive number for the age threshold.",
                "warning"
            );
            daysInput.focus();
            return false;
        }

        localStorage.setItem(CONFIG.storageDaysKey, String(days));

        state.running = true;
        state.stopRequested = false;
        state.processedRoomIds.clear();
        state.candidates.clear();

        state.stats = {
            checked: 0,
            old: 0,
            hidden: 0,
            skipped: 0,
            errors: 0,
        };
        state.currentChatName = null;

        runButton.disabled = true;
        stopButton.disabled = false;
        quickHideButton.disabled = true;
        daysInput.disabled = true;

        if (modeToggle) {
            modeToggle.disabled = true;
        }

        updateStatsDisplay();
        clearLog();
        renderCandidateList();
        setActiveTab("activity");
        setUiStatus(
            "running",
            sendIt ? "Send it running" : "Scanning before confirmation",
            "Locating Reddit's conversation list…"
        );

        log(
            sendIt
                ? `Starting Send it cleanup. Threshold: ${days} days. `
                    + "Matching chats will be hidden as they are found; "
                    + "messages are never deleted."
                : `Starting scan before confirmation. Threshold: ${days} `
                    + "days. Nothing changes until the review confirmation."
        );

        try {
            let chatList = null;
            const discoveryStarted = Date.now();
            let lastWaitingLog = 0;

            while (
                Date.now() - discoveryStarted
                < CONFIG.chatListLoadTimeoutMs
            ) {
                chatList = locateChatList();

                if (chatList) {
                    break;
                }

                const elapsed = Date.now() - discoveryStarted;

                if (elapsed - lastWaitingLog >= 2000) {
                    lastWaitingLog = elapsed;
                    const quickCounts = {
                        wrappers: deepQueryAll(
                            "rs-roving-focus-wrapper, rs-roving-focus-native"
                        ).length,
                        roomComponents: deepQueryAll(
                            "rs-rooms-nav-room"
                        ).length,
                        roomLinks: deepQueryAll(
                            CHAT_LINK_SELECTOR
                        ).length,
                    };

                    log(
                        "Still waiting for conversation rows to render…",
                        "debug",
                        quickCounts
                    );
                }

                await sleep(200);
            }

            if (!chatList) {
                const error = new Error(
                    "No conversation rows were detected. Expand Reddit's "
                    + "left chat sidebar and retry. If chats are visible, "
                    + "use Copy log to share the DOM diagnostics."
                );
                error.diagnostics = collectDomDiagnostics();
                throw error;
            }

            let container = chatList.container;

            log(
                `Conversation list found (${chatList.strategy}); `
                + `${chatList.items.length} rows currently rendered.`,
                "success"
            );
            setUiStatus(
                "running",
                sendIt ? "Send it running" : "Scanning before confirmation",
                `${chatList.items.length} conversation rows loaded`
            );

            let scrollElement = getScrollableChatList(container);

            if (scrollElement) {
                scrollElement.scrollTop = 0;
                await sleep(CONFIG.scrollDelayMs);
            }

            let scrollStalls = 0;
            let missingListCount = 0;
            let previousScrollTop = -1;
            let previousProcessedCount = -1;

            while (!state.stopRequested) {
                /*
                 * Re-find the container because Reddit can rebuild portions
                 * of the web component tree after hiding a conversation.
                 */
                chatList = locateChatList();
                container = chatList?.container || null;

                if (!container) {
                    missingListCount += 1;

                    if (missingListCount === 1) {
                        log(
                            "Conversation list was rebuilt; waiting for it…",
                            "warning"
                        );
                    }

                    if (missingListCount >= 10) {
                        const error = new Error(
                            "Conversation list did not return after Reddit "
                            + "rebuilt the page."
                        );
                        error.diagnostics = collectDomDiagnostics();
                        throw error;
                    }

                    await sleep(1000);
                    continue;
                }

                missingListCount = 0;

                const items = getChatItems(container);
                const nextItem = items.find((item) => {
                    const roomId = getRoomId(item);

                    return roomId
                        && !state.processedRoomIds.has(roomId);
                });

                if (nextItem) {
                    nextItem.scrollIntoView({
                        block: "center",
                        inline: "nearest",
                    });

                    await sleep(100);

                    await processChat(nextItem, days, { sendIt });

                    await sleep(250);
                    continue;
                }

                chatList = locateChatList();
                container = chatList?.container || null;

                if (!container) {
                    await sleep(500);
                    continue;
                }

                const currentScrollElement = getScrollableChatList(container);

                scrollElement = currentScrollElement
                    || (scrollElement?.isConnected ? scrollElement : null);

                if (!scrollElement) {
                    /*
                     * If there is no scrollable area, all visible chats have
                     * been inspected.
                     */
                    break;
                }

                const processedCount = state.processedRoomIds.size;
                const currentScrollTop = scrollElement.scrollTop;
                const maxScrollTop =
                    scrollElement.scrollHeight
                    - scrollElement.clientHeight;

                const atBottom =
                    currentScrollTop >= maxScrollTop - 10;

                if (atBottom) {
                    scrollStalls += 1;
                } else if (
                    currentScrollTop === previousScrollTop
                    && processedCount === previousProcessedCount
                ) {
                    scrollStalls += 1;
                } else {
                    scrollStalls = 0;
                }

                if (scrollStalls >= CONFIG.maxScrollStalls) {
                    log(
                        "Reached the end of the rendered conversation list.",
                        "debug",
                        {
                            processedRooms: processedCount,
                            scrollTop: Math.round(currentScrollTop),
                            maxScrollTop: Math.round(maxScrollTop),
                        }
                    );
                    break;
                }

                previousScrollTop = currentScrollTop;
                previousProcessedCount = processedCount;

                const scrollAmount = Math.max(
                    300,
                    scrollElement.clientHeight * CONFIG.scrollFraction
                );

                scrollElement.scrollTop = Math.min(
                    maxScrollTop,
                    scrollElement.scrollTop + scrollAmount
                );

                await sleep(CONFIG.scrollDelayMs);
            }

            if (state.stopRequested) {
                log("Scan stopped by user.", "warning");
                setUiStatus(
                    "warning",
                    "Scan stopped",
                    `${state.stats.checked} chats checked`
                );

                if (state.candidates.size) {
                    setActiveTab("review");
                }
            } else {
                scanCompleted = true;
                if (sendIt) {
                    log(
                        `Send it finished. Checked ${state.stats.checked}; `
                        + `found ${state.stats.old}; hidden `
                        + `${state.stats.hidden}; errors ${state.stats.errors}. `
                        + "No messages were deleted.",
                        state.stats.errors ? "warning" : "success"
                    );
                    setUiStatus(
                        state.stats.errors ? "warning" : "success",
                        state.stats.errors
                            ? "Send it finished with errors"
                            : "Send it complete",
                        `${state.stats.hidden} hidden · no messages deleted`
                    );
                } else {
                    log(
                        `Scan finished. Checked ${state.stats.checked}; `
                        + `found ${state.stats.old} older than ${days} days. `
                        + "Nothing has been hidden yet.",
                        "success"
                    );
                    setUiStatus(
                        "success",
                        "Scan complete",
                        state.stats.old
                            ? `${state.stats.old} matches ready to confirm`
                            : "No chats matched the threshold"
                    );

                    if (state.stats.old > 0) {
                        setActiveTab("review");
                    }
                }
            }
        } catch (error) {
            state.stats.errors += 1;
            updateStatsDisplay();

            log(
                error.message || String(error),
                "error",
                error.diagnostics || collectDomDiagnostics()
            );
            setUiStatus(
                "error",
                "Scan failed",
                "Open the diagnostic details or copy the log"
            );

            console.error(
                "[Reddit Hide Old Chats] Cleanup failed:",
                error
            );
        } finally {
            state.running = false;

            runButton.disabled = false;
            stopButton.disabled = true;
            quickHideButton.disabled = false;
            daysInput.disabled = false;

            if (modeToggle) {
                modeToggle.disabled = false;
            }

            renderCandidateList();
            updateReviewControls();
            syncWorkflowModeUi();
        }

        return scanCompleted;
    }

    async function runRequestedWorkflow() {
        const sendIt = document.getElementById("rhoc-send-it")
            ?.checked === true;

        if (sendIt) {
            const confirmed = window.confirm(
                "Send it mode hides matching chats immediately as they are "
                + "found. Continue?\n\nMessages will not be deleted."
            );

            if (!confirmed) {
                setUiStatus(
                    "warning",
                    "Send it cancelled",
                    "No scan was started and nothing was changed"
                );
                log(
                    "Send it was cancelled before scanning. Nothing was "
                    + "hidden or deleted.",
                    "warning"
                );
                return;
            }
        }

        const scanCompleted = await runCleanup({ sendIt });

        if (
            !scanCompleted
            || state.stopRequested
            || sendIt
            || state.candidates.size === 0
        ) {
            return;
        }

        setActiveTab("review");
        setUiStatus(
            "warning",
            "Review complete",
            `${getSelectedCandidates().length} matches awaiting confirmation`
        );
        log(
            "Scan then confirm finished scanning. Waiting for confirmation "
            + "before any chats are hidden.",
            "warning"
        );
        await hideSelectedCandidates();
    }

    async function hideSelectedCandidates() {
        if (state.running) {
            return;
        }

        const selected = getSelectedCandidates();

        if (!selected.length) {
            setUiStatus(
                "warning",
                "Nothing selected",
                "Select one or more reviewed candidates first"
            );
            return;
        }

        const confirmed = window.confirm(
            `Hide ${selected.length} selected conversation${
                selected.length === 1 ? "" : "s"
            }?\n\n`
            + "This uses Reddit's Hide chat action. The script never "
            + "deletes messages."
        );

        if (!confirmed) {
            setUiStatus(
                "warning",
                "Hide cancelled",
                `${selected.length} candidates remain available for review`
            );
            log(
                "Hide confirmation was cancelled. Nothing was hidden or "
                + "deleted.",
                "warning"
            );
            return;
        }

        const runButton = document.getElementById("rhoc-run");
        const stopButton = document.getElementById("rhoc-stop");
        const quickHideButton = document.getElementById("rhoc-hide-current");
        const daysInput = document.getElementById("rhoc-days");
        const modeToggle = document.getElementById("rhoc-send-it");
        const pendingRoomIds = new Set(
            selected.map((candidate) => candidate.roomId)
        );

        state.running = true;
        state.stopRequested = false;
        state.currentChatName = null;

        runButton.disabled = true;
        stopButton.disabled = false;
        quickHideButton.disabled = true;
        daysInput.disabled = true;

        if (modeToggle) {
            modeToggle.disabled = true;
        }

        renderCandidateList();
        setUiStatus(
            "running",
            "Hiding selected chats",
            `${pendingRoomIds.size} remaining · messages are not deleted`
        );
        log(
            `Starting hide pass for ${pendingRoomIds.size} reviewed `
            + "conversation(s). No messages will be deleted."
        );

        try {
            let chatList = null;
            const discoveryStarted = Date.now();

            while (
                Date.now() - discoveryStarted
                < CONFIG.chatListLoadTimeoutMs
            ) {
                chatList = locateChatList();

                if (chatList) {
                    break;
                }

                await sleep(200);
            }

            if (!chatList) {
                const error = new Error(
                    "Could not find the conversation list for the hide pass."
                );
                error.diagnostics = collectDomDiagnostics();
                throw error;
            }

            let container = chatList.container;
            let scrollElement = getScrollableChatList(container);

            if (scrollElement) {
                scrollElement.scrollTop = 0;
                await sleep(CONFIG.scrollDelayMs);
            }

            let scrollStalls = 0;
            let missingListCount = 0;

            while (pendingRoomIds.size && !state.stopRequested) {
                chatList = locateChatList();
                container = chatList?.container || null;

                if (!container) {
                    missingListCount += 1;

                    if (missingListCount >= 10) {
                        throw new Error(
                            "The conversation list did not return during "
                            + "the hide pass."
                        );
                    }

                    await sleep(750);
                    continue;
                }

                missingListCount = 0;

                const targetItem = getChatItems(container).find((item) => (
                    pendingRoomIds.has(getRoomId(item))
                ));

                if (targetItem) {
                    const roomId = getRoomId(targetItem);
                    const candidate = state.candidates.get(roomId);

                    candidate.status = "hiding";
                    state.currentChatName = candidate.name;
                    renderCandidateList();
                    setUiStatus(
                        "running",
                        "Hiding selected chats",
                        `${candidate.name} · ${pendingRoomIds.size} remaining`
                    );
                    log(`${candidate.name}: opening for reviewed hide…`);

                    targetItem.scrollIntoView({
                        block: "center",
                        inline: "nearest",
                    });
                    await sleep(100);

                    const openResult = await openChat(
                        targetItem,
                        candidate.name
                    );

                    if (state.stopRequested) {
                        candidate.status = "ready";
                        renderCandidateList();
                        break;
                    }

                    if (!openResult.success) {
                        candidate.status = "error";
                        state.stats.errors += 1;
                        log(
                            `${candidate.name}: ${openResult.reason} It was `
                            + "not hidden.",
                            "error",
                            openResult.details
                        );
                    } else {
                        const result = await hideCurrentChat();

                        if (result.success) {
                            candidate.status = "hidden";
                            candidate.selected = false;
                            state.stats.hidden += 1;
                            log(
                                `${candidate.name}: hidden. Messages were `
                                + "not deleted.",
                                "success"
                            );
                        } else {
                            candidate.status = "error";
                            state.stats.errors += 1;
                            log(
                                `${candidate.name}: ${result.reason} `
                                + "Nothing was deleted.",
                                "error"
                            );
                        }
                    }

                    pendingRoomIds.delete(roomId);
                    updateStatsDisplay();
                    renderCandidateList();
                    scrollStalls = 0;
                    await sleep(CONFIG.postHideDelayMs);
                    continue;
                }

                const currentScrollElement = getScrollableChatList(container);

                scrollElement = currentScrollElement
                    || (scrollElement?.isConnected ? scrollElement : null);

                if (!scrollElement) {
                    break;
                }

                const maxScrollTop = Math.max(
                    0,
                    scrollElement.scrollHeight - scrollElement.clientHeight
                );
                const currentScrollTop = scrollElement.scrollTop;
                const scrollAmount = Math.max(
                    300,
                    scrollElement.clientHeight * CONFIG.scrollFraction
                );
                const nextScrollTop = Math.min(
                    maxScrollTop,
                    currentScrollTop + scrollAmount
                );

                if (nextScrollTop <= currentScrollTop + 1) {
                    scrollStalls += 1;
                } else {
                    scrollStalls = 0;
                }

                if (scrollStalls >= CONFIG.maxScrollStalls) {
                    break;
                }

                scrollElement.scrollTop = nextScrollTop;
                await sleep(CONFIG.scrollDelayMs);
            }

            if (state.stopRequested) {
                log("Hide pass stopped by user.", "warning");
                setUiStatus(
                    "warning",
                    "Hide pass stopped",
                    `${state.stats.hidden} chats hidden`
                );
            } else if (pendingRoomIds.size) {
                for (const roomId of pendingRoomIds) {
                    const candidate = state.candidates.get(roomId);

                    if (candidate) {
                        candidate.status = "error";
                    }
                }

                state.stats.errors += pendingRoomIds.size;
                updateStatsDisplay();
                log(
                    `${pendingRoomIds.size} reviewed conversation(s) could `
                    + "not be found again. They were not hidden or deleted.",
                    "error"
                );
                setUiStatus(
                    "error",
                    "Hide pass incomplete",
                    `${state.stats.hidden} hidden · ${pendingRoomIds.size} not found`
                );
            } else {
                log(
                    `Hide pass complete. ${state.stats.hidden} conversation(s) `
                    + "hidden; no messages deleted.",
                    "success"
                );
                setUiStatus(
                    "success",
                    "Hide pass complete",
                    `${state.stats.hidden} hidden · no messages deleted`
                );
            }
        } catch (error) {
            state.stats.errors += 1;
            updateStatsDisplay();
            log(
                error.message || String(error),
                "error",
                error.diagnostics || collectDomDiagnostics()
            );
            setUiStatus(
                "error",
                "Hide pass failed",
                "Unprocessed selections were not changed"
            );
        } finally {
            for (const candidate of state.candidates.values()) {
                if (candidate.status === "hiding") {
                    candidate.status = "ready";
                }
            }

            state.running = false;
            state.currentChatName = null;
            runButton.disabled = false;
            stopButton.disabled = true;
            quickHideButton.disabled = false;
            daysInput.disabled = false;

            if (modeToggle) {
                modeToggle.disabled = false;
            }

            renderCandidateList();
            updateReviewControls();
            syncWorkflowModeUi();
        }
    }

    function stopCleanup() {
        if (!state.running) {
            return;
        }

        state.stopRequested = true;

        log("Stop requested. Finishing the current operation...", "warning");
        setUiStatus(
            "warning",
            "Stopping…",
            state.currentChatName
                ? `Finishing ${state.currentChatName}`
                : "Finishing the current operation"
        );
    }

    function clampPanelToViewport(panel) {
        if (!panel.style.left || !panel.style.top) {
            return;
        }

        const margin = 8;
        const rect = panel.getBoundingClientRect();
        const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
        const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);
        const left = Math.min(Math.max(margin, rect.left), maxLeft);
        const top = Math.min(Math.max(margin, rect.top), maxTop);

        panel.style.left = `${Math.round(left)}px`;
        panel.style.top = `${Math.round(top)}px`;
    }

    function savePanelPosition(panel) {
        if (!panel.style.left || !panel.style.top) {
            return;
        }

        localStorage.setItem(CONFIG.storagePositionKey, JSON.stringify({
            left: Number.parseFloat(panel.style.left),
            top: Number.parseFloat(panel.style.top),
        }));
    }

    function restorePanelPosition(panel) {
        const savedPosition = localStorage.getItem(CONFIG.storagePositionKey);

        if (!savedPosition) {
            return;
        }

        try {
            const position = JSON.parse(savedPosition);

            if (
                !Number.isFinite(position.left)
                || !Number.isFinite(position.top)
            ) {
                throw new Error("Invalid saved position");
            }

            panel.style.left = `${position.left}px`;
            panel.style.top = `${position.top}px`;
            panel.style.right = "auto";
            panel.style.bottom = "auto";
            clampPanelToViewport(panel);
        } catch {
            localStorage.removeItem(CONFIG.storagePositionKey);
        }
    }

    function resetPanelPosition(panel) {
        panel.style.left = "";
        panel.style.top = "";
        panel.style.right = "16px";
        panel.style.bottom = "16px";
        localStorage.removeItem(CONFIG.storagePositionKey);
    }

    function updateCollapseButton(panel) {
        const button = document.getElementById("rhoc-collapse");
        const collapsed = panel.classList.contains("rhoc-collapsed");

        if (!button) {
            return;
        }

        button.textContent = collapsed ? "+" : "−";
        button.title = collapsed ? "Expand panel" : "Minimize panel";
        button.setAttribute("aria-label", button.title);
        button.setAttribute("aria-expanded", String(!collapsed));
    }

    function togglePanelCollapsed(panel) {
        panel.classList.toggle("rhoc-collapsed");
        const collapsed = panel.classList.contains("rhoc-collapsed");

        localStorage.setItem(CONFIG.storageCollapsedKey, String(collapsed));
        updateCollapseButton(panel);

        window.requestAnimationFrame(() => {
            clampPanelToViewport(panel);
            savePanelPosition(panel);
        });
    }

    function enablePanelDragging(panel) {
        const handle = document.getElementById("rhoc-header");

        if (!handle) {
            return;
        }

        handle.addEventListener("pointerdown", (event) => {
            if (event.button !== 0 || event.target.closest("button")) {
                return;
            }

            const rect = panel.getBoundingClientRect();
            const offsetX = event.clientX - rect.left;
            const offsetY = event.clientY - rect.top;

            panel.style.left = `${rect.left}px`;
            panel.style.top = `${rect.top}px`;
            panel.style.right = "auto";
            panel.style.bottom = "auto";
            panel.classList.add("rhoc-dragging");
            handle.setPointerCapture(event.pointerId);

            const move = (moveEvent) => {
                const margin = 8;
                const maxLeft = Math.max(
                    margin,
                    window.innerWidth - panel.offsetWidth - margin
                );
                const maxTop = Math.max(
                    margin,
                    window.innerHeight - panel.offsetHeight - margin
                );
                const left = Math.min(
                    Math.max(margin, moveEvent.clientX - offsetX),
                    maxLeft
                );
                const top = Math.min(
                    Math.max(margin, moveEvent.clientY - offsetY),
                    maxTop
                );

                panel.style.left = `${Math.round(left)}px`;
                panel.style.top = `${Math.round(top)}px`;
            };

            const finish = () => {
                panel.classList.remove("rhoc-dragging");
                savePanelPosition(panel);
                handle.removeEventListener("pointermove", move);
                handle.removeEventListener("pointerup", finish);
                handle.removeEventListener("pointercancel", finish);
            };

            handle.addEventListener("pointermove", move);
            handle.addEventListener("pointerup", finish);
            handle.addEventListener("pointercancel", finish);
        });
    }

    function createPanel() {
        if (document.getElementById("rhoc-panel")) {
            return;
        }

        const savedDays = localStorage.getItem(CONFIG.storageDaysKey);
        const savedWorkflowMode = localStorage.getItem(
            CONFIG.storageWorkflowModeKey
        );
        const savedCollapsed = localStorage.getItem(
            CONFIG.storageCollapsedKey
        );
        const days = savedDays !== null
            ? savedDays
            : String(CONFIG.defaultDays);
        const panel = document.createElement("aside");

        panel.id = "rhoc-panel";
        panel.setAttribute("aria-label", "Reddit old chat cleanup");

        panel.innerHTML = `
            <style>
                #rhoc-panel {
                    position: fixed;
                    right: 16px;
                    bottom: 16px;
                    z-index: 2147483647;
                    display: flex;
                    width: min(440px, calc(100vw - 24px));
                    height: min(760px, calc(100vh - 24px));
                    max-height: min(760px, calc(100vh - 24px));
                    box-sizing: border-box;
                    flex-direction: column;
                    overflow: hidden;
                    border: 1px solid #34383d;
                    border-radius: 14px;
                    background: #17191c;
                    color: #f2f3f5;
                    box-shadow: 0 18px 55px rgba(0, 0, 0, 0.52);
                    font: 13px/1.4 -apple-system, BlinkMacSystemFont,
                        "Segoe UI", sans-serif;
                    color-scheme: dark;
                }

                #rhoc-panel, #rhoc-panel * { box-sizing: border-box; }

                #rhoc-panel.rhoc-dragging {
                    opacity: 0.94;
                    box-shadow: 0 24px 70px rgba(0, 0, 0, 0.62);
                }

                #rhoc-header {
                    display: flex;
                    min-height: 58px;
                    align-items: center;
                    gap: 10px;
                    padding: 11px 12px;
                    border-bottom: 1px solid #2b2e33;
                    background: #1d2024;
                    cursor: grab;
                    touch-action: none;
                    user-select: none;
                }

                #rhoc-panel.rhoc-dragging #rhoc-header { cursor: grabbing; }

                .rhoc-brand-icon {
                    display: grid;
                    width: 34px;
                    height: 34px;
                    flex: 0 0 auto;
                    place-items: center;
                    border-radius: 10px;
                    background: #ff4500;
                    color: white;
                    font-size: 18px;
                    font-weight: 800;
                }

                .rhoc-title-group { min-width: 0; flex: 1; }

                #rhoc-title {
                    overflow: hidden;
                    color: #fff;
                    font-size: 14px;
                    font-weight: 700;
                    letter-spacing: -0.01em;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }

                #rhoc-header-subtitle {
                    margin-top: 1px;
                    color: #969ca5;
                    font-size: 11px;
                }

                .rhoc-header-status-dot {
                    width: 8px;
                    height: 8px;
                    flex: 0 0 auto;
                    border-radius: 50%;
                    background: #727983;
                }

                #rhoc-panel[data-status="running"] .rhoc-header-status-dot {
                    background: #4aa8ff;
                    animation: rhoc-pulse 1.2s ease-in-out infinite;
                }
                #rhoc-panel[data-status="success"] .rhoc-header-status-dot {
                    background: #43c78a;
                }
                #rhoc-panel[data-status="warning"] .rhoc-header-status-dot {
                    background: #f2b84b;
                }
                #rhoc-panel[data-status="error"] .rhoc-header-status-dot {
                    background: #ff625f;
                }

                .rhoc-header-actions { display: flex; gap: 5px; }

                #rhoc-panel button {
                    appearance: none;
                    border: 0;
                    font: inherit;
                }

                .rhoc-icon-button {
                    display: grid;
                    width: 30px;
                    height: 30px;
                    place-items: center;
                    border: 1px solid #3a3e44 !important;
                    border-radius: 8px;
                    background: #25282d;
                    color: #c7cbd1;
                    cursor: pointer;
                    font-size: 17px !important;
                    line-height: 1 !important;
                }

                .rhoc-icon-button:hover {
                    border-color: #555b63 !important;
                    background: #30343a;
                    color: #fff;
                }

                .rhoc-panel-body {
                    display: flex;
                    min-height: 0;
                    flex: 1 1 auto;
                    flex-direction: column;
                    overflow: hidden;
                    padding: 14px;
                }

                .rhoc-settings {
                    display: grid;
                    grid-template-columns: minmax(0, 1fr) minmax(0, 1.18fr);
                    flex: 0 0 auto;
                    gap: 10px;
                }

                .rhoc-settings > * { min-width: 0; }

                .rhoc-field-label {
                    display: block;
                    margin-bottom: 5px;
                    color: #aeb3bb;
                    font-size: 11px;
                    font-weight: 650;
                    letter-spacing: 0.03em;
                    text-transform: uppercase;
                }

                .rhoc-number-wrap {
                    display: flex;
                    height: 42px;
                    align-items: center;
                    overflow: hidden;
                    border: 1px solid #3a3e44;
                    border-radius: 9px;
                    background: #111315;
                }

                #rhoc-days {
                    min-width: 0;
                    height: 100%;
                    flex: 1;
                    padding: 0 10px;
                    border: 0;
                    outline: 0;
                    background: transparent;
                    color: #fff;
                    font: 600 14px/1 inherit;
                }

                .rhoc-number-unit {
                    padding: 0 10px;
                    color: #858b94;
                    font-size: 12px;
                }

                #rhoc-mode-card {
                    position: relative;
                    display: flex;
                    min-width: 0;
                    align-items: center;
                    gap: 9px;
                    padding: 7px 9px;
                    border: 1px solid #315a49;
                    border-radius: 9px;
                    background: #16241e;
                    cursor: pointer;
                    overflow: hidden;
                }

                #rhoc-mode-card[data-mode="send"] {
                    border-color: #744021;
                    background: #2a1d16;
                }

                #rhoc-send-it {
                    position: absolute;
                    width: 1px;
                    height: 1px;
                    opacity: 0;
                }

                .rhoc-mode-switch {
                    position: relative;
                    width: 34px;
                    height: 20px;
                    flex: 0 0 auto;
                    border: 1px solid #34735a;
                    border-radius: 99px;
                    background: #286047;
                    transition: background 0.16s ease,
                        border-color 0.16s ease;
                }

                .rhoc-mode-switch::after {
                    position: absolute;
                    top: 2px;
                    left: 2px;
                    width: 14px;
                    height: 14px;
                    border-radius: 50%;
                    background: #fff;
                    content: "";
                    transition: transform 0.16s ease;
                }

                #rhoc-send-it:checked + .rhoc-mode-switch {
                    border-color: #8b4a28;
                    background: #67371f;
                }

                #rhoc-send-it:checked + .rhoc-mode-switch::after {
                    transform: translateX(14px);
                }

                #rhoc-send-it:focus-visible + .rhoc-mode-switch {
                    outline: 2px solid #8ebee8;
                    outline-offset: 2px;
                }

                #rhoc-send-it:disabled + .rhoc-mode-switch,
                #rhoc-send-it:disabled ~ .rhoc-mode-copy {
                    opacity: 0.5;
                }

                .rhoc-mode-copy { display: block; min-width: 0; }
                #rhoc-mode-title {
                    display: block;
                    font-size: 12px;
                    font-weight: 700;
                }
                #rhoc-mode-description {
                    display: block;
                    color: #9399a2;
                    font-size: 10px;
                    line-height: 1.2;
                    white-space: normal;
                }

                .rhoc-actions {
                    display: grid;
                    grid-template-columns: minmax(0, 1fr) auto auto;
                    gap: 8px;
                    margin-top: 11px;
                }

                .rhoc-primary-button,
                .rhoc-quick-hide-button,
                .rhoc-stop-button {
                    min-height: 40px;
                    padding: 0 15px;
                    border-radius: 9px !important;
                    cursor: pointer;
                    font-weight: 700 !important;
                }

                .rhoc-primary-button { background: #3178c6; color: #fff; }
                .rhoc-primary-button:hover { background: #3987dc; }
                .rhoc-quick-hide-button {
                    border: 1px solid #754122 !important;
                    background: #2a1d16;
                    color: #f2a177;
                }
                .rhoc-quick-hide-button:hover {
                    border-color: #a65a2f !important;
                    background: #382218;
                    color: #ffc09f;
                }
                .rhoc-stop-button { background: #32363c; color: #e5e7ea; }
                .rhoc-stop-button:hover { background: #3d4249; }

                #rhoc-panel button:disabled, #rhoc-panel input:disabled {
                    cursor: not-allowed;
                    opacity: 0.45;
                }

                #rhoc-status {
                    display: grid;
                    grid-template-columns: auto 1fr;
                    column-gap: 9px;
                    margin-top: 12px;
                    padding: 10px;
                    border: 1px solid #30343a;
                    border-radius: 9px;
                    background: #202328;
                }

                .rhoc-status-dot {
                    width: 9px;
                    height: 9px;
                    margin-top: 4px;
                    border-radius: 50%;
                    background: #727983;
                    box-shadow: 0 0 0 3px rgba(114, 121, 131, 0.14);
                }

                #rhoc-status[data-status="running"] .rhoc-status-dot {
                    background: #4aa8ff;
                    box-shadow: 0 0 0 3px rgba(74, 168, 255, 0.15);
                    animation: rhoc-pulse 1.2s ease-in-out infinite;
                }

                #rhoc-status[data-status="success"] .rhoc-status-dot {
                    background: #43c78a;
                }

                #rhoc-status[data-status="warning"] .rhoc-status-dot {
                    background: #f2b84b;
                }

                #rhoc-status[data-status="error"] .rhoc-status-dot {
                    background: #ff625f;
                }

                @keyframes rhoc-pulse {
                    50% { opacity: 0.45; transform: scale(0.8); }
                }

                #rhoc-status-label { font-size: 12px; font-weight: 700; }
                #rhoc-status-detail {
                    grid-column: 2;
                    overflow: hidden;
                    color: #9298a1;
                    font-size: 10px;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }

                #rhoc-stats {
                    display: grid;
                    grid-template-columns: repeat(5, 1fr);
                    gap: 5px;
                    margin: 10px 0 12px;
                }

                .rhoc-stat {
                    min-width: 0;
                    padding: 7px 3px;
                    border: 1px solid #2d3035;
                    border-radius: 8px;
                    background: #1c1f23;
                    text-align: center;
                }

                .rhoc-stat-value {
                    display: block;
                    color: #fff;
                    font-size: 15px;
                    font-weight: 750;
                    line-height: 1.2;
                }

                .rhoc-stat-label {
                    display: block;
                    margin-top: 2px;
                    color: #777e88;
                    font-size: 9px;
                    letter-spacing: 0.03em;
                    text-transform: uppercase;
                }

                .rhoc-tabs {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    flex: 0 0 auto;
                    margin-bottom: 8px;
                    padding: 3px;
                    border-radius: 9px;
                    background: #111315;
                }

                .rhoc-tab {
                    padding: 6px 8px;
                    border-radius: 7px !important;
                    background: transparent;
                    color: #858c96;
                    cursor: pointer;
                    font-size: 11px !important;
                    font-weight: 700 !important;
                }

                .rhoc-tab.rhoc-active {
                    background: #292d32;
                    color: #fff;
                    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
                }

                .rhoc-tab-count {
                    display: inline-grid;
                    min-width: 18px;
                    height: 18px;
                    margin-left: 4px;
                    padding: 0 5px;
                    place-items: center;
                    border-radius: 99px;
                    background: #3a3f46;
                    color: #d9dce1;
                    font-size: 9px;
                }

                [data-rhoc-tab-panel][hidden] { display: none !important; }

                [data-rhoc-tab-panel]:not([hidden]) {
                    display: flex;
                    min-height: 0;
                    flex: 1 1 220px;
                    flex-direction: column;
                }

                .rhoc-review-toolbar,
                .rhoc-review-footer {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 8px;
                }

                .rhoc-review-toolbar { margin-bottom: 6px; }
                #rhoc-selection-summary {
                    color: #aeb3bb;
                    font-size: 10px;
                    font-weight: 650;
                }

                .rhoc-candidate-list {
                    min-height: 130px;
                    flex: 1 1 auto;
                    overflow-y: auto;
                    overflow-x: hidden;
                    border: 1px solid #30343a;
                    border-radius: 9px;
                    background: #0e1012;
                    scrollbar-color: #464b53 transparent;
                }

                .rhoc-candidate-empty {
                    display: grid;
                    height: 100%;
                    padding: 28px;
                    place-items: center;
                    color: #777e88;
                    font-size: 11px;
                    line-height: 1.5;
                    text-align: center;
                }

                .rhoc-candidate-row {
                    display: grid;
                    grid-template-columns: 18px minmax(0, 1fr) auto;
                    align-items: center;
                    gap: 9px;
                    min-height: 54px;
                    padding: 7px 9px;
                    border-bottom: 1px solid #24272b;
                    cursor: pointer;
                }

                .rhoc-candidate-row:last-child { border-bottom: 0; }
                .rhoc-candidate-row:hover { background: #171a1e; }
                .rhoc-candidate-row[data-selected="false"] { opacity: 0.58; }
                .rhoc-candidate-row[data-status="hidden"] {
                    background: #13231c;
                    opacity: 0.78;
                }

                .rhoc-candidate-row input {
                    width: 15px;
                    height: 15px;
                    margin: 0;
                    accent-color: #ff6a28;
                }

                .rhoc-candidate-copy { display: block; min-width: 0; }
                .rhoc-candidate-name {
                    display: block;
                    overflow: hidden;
                    color: #e8eaed;
                    font-size: 11px;
                    font-weight: 700;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }

                .rhoc-candidate-meta {
                    display: block;
                    margin-top: 2px;
                    overflow: hidden;
                    color: #777e88;
                    font-size: 9.5px;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }

                .rhoc-candidate-badge {
                    padding: 3px 6px;
                    border-radius: 99px;
                    background: #46281d;
                    color: #ffad86;
                    font-size: 8px;
                    font-weight: 750;
                    letter-spacing: 0.04em;
                    text-transform: uppercase;
                }

                .rhoc-candidate-row[data-selected="false"]
                    .rhoc-candidate-badge {
                    background: #2b2e33;
                    color: #9298a1;
                }

                .rhoc-candidate-row[data-status="hidden"]
                    .rhoc-candidate-badge {
                    background: #1d4937;
                    color: #75e3ad;
                }

                .rhoc-candidate-row[data-status="error"]
                    .rhoc-candidate-badge {
                    background: #4c2525;
                    color: #ff9b98;
                }

                .rhoc-review-footer {
                    align-items: flex-end;
                    margin-top: 8px;
                }

                .rhoc-review-safety {
                    max-width: 235px;
                    color: #858c96;
                    font-size: 9.5px;
                    line-height: 1.35;
                }

                #rhoc-hide-selected {
                    min-height: 34px;
                    padding: 0 12px;
                    border-radius: 8px !important;
                    background: #d94d17;
                    color: #fff;
                    cursor: pointer;
                    font-size: 11px !important;
                    font-weight: 750 !important;
                    white-space: nowrap;
                }

                #rhoc-hide-selected:hover { background: #ed5a20; }

                .rhoc-log-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    margin-bottom: 6px;
                }

                .rhoc-log-title {
                    color: #aeb3bb;
                    font-size: 11px;
                    font-weight: 700;
                    letter-spacing: 0.04em;
                    text-transform: uppercase;
                }

                .rhoc-log-tools { display: flex; gap: 5px; }

                .rhoc-text-button {
                    padding: 3px 7px;
                    border-radius: 5px !important;
                    background: transparent;
                    color: #8ebee8;
                    cursor: pointer;
                    font-size: 10px !important;
                }

                .rhoc-text-button:hover { background: #282c31; color: #b9dcfa; }

                #rhoc-log {
                    min-height: 130px;
                    flex: 1 1 auto;
                    overflow-y: auto;
                    overflow-x: hidden;
                    padding: 5px 9px;
                    border: 1px solid #30343a;
                    border-radius: 9px;
                    background: #0e1012;
                    color: #c9cdd3;
                    font: 10.5px/1.45 ui-monospace, SFMono-Regular, Menlo,
                        Consolas, monospace;
                    overflow-wrap: anywhere;
                    scrollbar-color: #464b53 transparent;
                }

                .rhoc-log-entry {
                    display: grid;
                    grid-template-columns: 57px 12px 1fr;
                    gap: 4px;
                    padding: 5px 0;
                    border-bottom: 1px solid #1c1f23;
                }

                .rhoc-log-entry:last-child { border-bottom: 0; }
                .rhoc-log-time { color: #666d77; }
                .rhoc-log-marker { color: #78808b; font-weight: 800; }
                .rhoc-log-success .rhoc-log-marker { color: #43c78a; }
                .rhoc-log-warning .rhoc-log-marker { color: #f2b84b; }
                .rhoc-log-error .rhoc-log-marker { color: #ff625f; }
                .rhoc-log-error .rhoc-log-message { color: #ffc0be; }
                .rhoc-log-debug { color: #858c96; }

                .rhoc-log-message details { margin-top: 4px; color: #8ebee8; }
                .rhoc-log-message summary { cursor: pointer; }
                .rhoc-log-message pre {
                    max-height: 130px;
                    margin: 5px 0 0;
                    overflow: auto;
                    color: #aeb4bd;
                    font: inherit;
                    white-space: pre-wrap;
                }

                #rhoc-note {
                    flex: 0 0 auto;
                    margin: 8px 2px 0;
                    color: #747b85;
                    font-size: 9.5px;
                    line-height: 1.35;
                }

                #rhoc-panel.rhoc-collapsed {
                    width: auto;
                    height: auto;
                    min-width: 205px;
                    max-height: none;
                    border-radius: 12px;
                }

                #rhoc-panel.rhoc-collapsed .rhoc-panel-body { display: none; }
                #rhoc-panel.rhoc-collapsed #rhoc-header {
                    min-height: 0;
                    padding: 8px 9px;
                    border-bottom: 0;
                }
                #rhoc-panel.rhoc-collapsed .rhoc-brand-icon {
                    width: 28px;
                    height: 28px;
                    border-radius: 8px;
                    font-size: 15px;
                }
                #rhoc-panel.rhoc-collapsed #rhoc-header-subtitle,
                #rhoc-panel.rhoc-collapsed #rhoc-reset-position { display: none; }

                .rhoc-candidate-list,
                #rhoc-log {
                    scrollbar-width: thin;
                    scrollbar-color: #3d4249 transparent;
                }

                .rhoc-candidate-list::-webkit-scrollbar,
                #rhoc-log::-webkit-scrollbar {
                    width: 6px;
                    height: 6px;
                }

                .rhoc-candidate-list::-webkit-scrollbar-track,
                #rhoc-log::-webkit-scrollbar-track {
                    background: transparent;
                }

                .rhoc-candidate-list::-webkit-scrollbar-thumb,
                #rhoc-log::-webkit-scrollbar-thumb {
                    border-radius: 99px;
                    background: #3d4249;
                }

                @media (max-height: 650px) {
                    #rhoc-log, .rhoc-candidate-list { min-height: 90px; }
                    #rhoc-note { display: none; }
                }
            </style>

            <header id="rhoc-header" title="Drag to move">
                <div class="rhoc-brand-icon" aria-hidden="true">R</div>
                <div class="rhoc-title-group">
                    <div id="rhoc-title">Old Chat Cleanup</div>
                    <div id="rhoc-header-subtitle">Reddit · v${CONFIG.version}</div>
                </div>
                <span class="rhoc-header-status-dot" aria-hidden="true"></span>
                <div class="rhoc-header-actions">
                    <button id="rhoc-reset-position" class="rhoc-icon-button"
                        type="button" title="Reset panel position"
                        aria-label="Reset panel position">↺</button>
                    <button id="rhoc-collapse" class="rhoc-icon-button"
                        type="button" title="Minimize panel"
                        aria-label="Minimize panel">−</button>
                </div>
            </header>

            <div class="rhoc-panel-body">
                <div class="rhoc-settings">
                    <div>
                        <label class="rhoc-field-label" for="rhoc-days">
                            Age threshold
                        </label>
                        <div class="rhoc-number-wrap">
                            <input id="rhoc-days" type="number" min="0" step="1">
                            <span class="rhoc-number-unit">days</span>
                        </div>
                    </div>

                    <div>
                        <span class="rhoc-field-label">Cleanup mode</span>
                        <label id="rhoc-mode-card">
                            <input id="rhoc-send-it" type="checkbox"
                                aria-label="Hide matching chats as they are found">
                            <span class="rhoc-mode-switch" aria-hidden="true"></span>
                            <span class="rhoc-mode-copy">
                                <span id="rhoc-mode-title">Scan then confirm</span>
                                <span id="rhoc-mode-description">
                                    Review all matches before hiding
                                </span>
                            </span>
                        </label>
                    </div>
                </div>

                <div class="rhoc-actions">
                    <button id="rhoc-run" class="rhoc-primary-button" type="button">
                        Scan conversations
                    </button>
                    <button id="rhoc-hide-current"
                        class="rhoc-quick-hide-button" type="button"
                        title="Hide the currently open chat">
                        Hide current
                    </button>
                    <button id="rhoc-stop" class="rhoc-stop-button" type="button"
                        disabled>Stop</button>
                </div>

                <div id="rhoc-status" data-status="idle" aria-live="polite">
                    <span class="rhoc-status-dot" aria-hidden="true"></span>
                    <span id="rhoc-status-label">Ready</span>
                    <span id="rhoc-status-detail">Waiting to scan</span>
                </div>

                <div id="rhoc-stats">
                    <div class="rhoc-stat"><span class="rhoc-stat-value"
                        data-rhoc-stat="checked">0</span><span
                        class="rhoc-stat-label">Checked</span></div>
                    <div class="rhoc-stat"><span class="rhoc-stat-value"
                        data-rhoc-stat="old">0</span><span
                        class="rhoc-stat-label">Candidates</span></div>
                    <div class="rhoc-stat"><span class="rhoc-stat-value"
                        data-rhoc-stat="hidden">0</span><span
                        class="rhoc-stat-label">Hidden</span></div>
                    <div class="rhoc-stat"><span class="rhoc-stat-value"
                        data-rhoc-stat="skipped">0</span><span
                        class="rhoc-stat-label">Skipped</span></div>
                    <div class="rhoc-stat"><span class="rhoc-stat-value"
                        data-rhoc-stat="errors">0</span><span
                        class="rhoc-stat-label">Errors</span></div>
                </div>

                <div class="rhoc-tabs" role="tablist"
                    aria-label="Cleanup results">
                    <button class="rhoc-tab rhoc-active" type="button"
                        role="tab" data-rhoc-tab="review" aria-selected="true">
                        Review <span id="rhoc-review-tab-count"
                            class="rhoc-tab-count">0</span>
                    </button>
                    <button class="rhoc-tab" type="button" role="tab"
                        data-rhoc-tab="activity" aria-selected="false">
                        Activity
                    </button>
                </div>

                <section data-rhoc-tab-panel="review">
                    <div class="rhoc-review-toolbar">
                        <span id="rhoc-selection-summary">No candidates yet</span>
                        <span class="rhoc-log-tools">
                            <button id="rhoc-select-all" class="rhoc-text-button"
                                type="button">Select all</button>
                            <button id="rhoc-select-none" class="rhoc-text-button"
                                type="button">Select none</button>
                        </span>
                    </div>
                    <div id="rhoc-candidate-list"
                        class="rhoc-candidate-list"></div>
                    <div class="rhoc-review-footer">
                        <span class="rhoc-review-safety">
                            Hiding uses Reddit’s “Hide chat” action. This script
                            never deletes messages.
                        </span>
                        <button id="rhoc-hide-selected" type="button" disabled>
                            Hide selected
                        </button>
                    </div>
                </section>

                <section data-rhoc-tab-panel="activity" hidden>
                    <div class="rhoc-log-header">
                        <span class="rhoc-log-title">Activity log</span>
                        <span class="rhoc-log-tools">
                            <button id="rhoc-copy-log" class="rhoc-text-button"
                                type="button">Copy log</button>
                            <button id="rhoc-clear-log" class="rhoc-text-button"
                                type="button">Clear</button>
                        </span>
                    </div>
                    <div id="rhoc-log" role="log" aria-live="polite"></div>
                </section>

                <div id="rhoc-note">
                    Sidebar dates are used when trustworthy; otherwise the chat
                    is opened to verify its newest message. Uncertain dates are
                    skipped. Drag the header to move or use − to minimize.
                </div>
            </div>
        `;

        document.body.appendChild(panel);

        const daysInput = document.getElementById("rhoc-days");
        const sendItToggle = document.getElementById("rhoc-send-it");

        daysInput.value = days;
        sendItToggle.checked = savedWorkflowMode === "send-it";

        if (savedCollapsed === "true") {
            panel.classList.add("rhoc-collapsed");
        }

        restorePanelPosition(panel);
        updateCollapseButton(panel);
        enablePanelDragging(panel);
        renderCandidateList();
        setActiveTab("review");
        syncWorkflowModeUi();

        document.getElementById("rhoc-run")
            .addEventListener("click", runRequestedWorkflow);
        document.getElementById("rhoc-hide-current")
            .addEventListener("click", hideCurrentlyActiveChatManually);
        sendItToggle.addEventListener("change", () => {
            localStorage.setItem(
                CONFIG.storageWorkflowModeKey,
                sendItToggle.checked ? "send-it" : "confirm"
            );
            syncWorkflowModeUi();
        });
        document.getElementById("rhoc-stop")
            .addEventListener("click", stopCleanup);
        document.getElementById("rhoc-copy-log")
            .addEventListener("click", copyLog);
        document.getElementById("rhoc-clear-log")
            .addEventListener("click", clearLog);
        document.getElementById("rhoc-hide-selected")
            .addEventListener("click", hideSelectedCandidates);
        document.getElementById("rhoc-select-all")
            .addEventListener("click", () => setCandidateSelection(true));
        document.getElementById("rhoc-select-none")
            .addEventListener("click", () => setCandidateSelection(false));
        document.getElementById("rhoc-collapse")
            .addEventListener("click", () => togglePanelCollapsed(panel));
        document.getElementById("rhoc-reset-position")
            .addEventListener("click", () => resetPanelPosition(panel));
        for (const tab of document.querySelectorAll("[data-rhoc-tab]")) {
            tab.addEventListener("click", () => {
                setActiveTab(tab.dataset.rhocTab);
            });
        }

        window.addEventListener("resize", () => {
            clampPanelToViewport(panel);
            savePanelPosition(panel);
        });

        const located = locateChatList();

        if (located) {
            setUiStatus(
                "idle",
                "Ready",
                `${located.items.length} conversation rows currently rendered`
            );
            log(
                `Ready. Found ${located.items.length} rendered `
                + `conversation rows via ${located.strategy}.`,
                "success"
            );
        } else {
            setUiStatus(
                "warning",
                "Waiting for chats",
                "The scan will keep looking after you click Start"
            );
            log(
                "Panel ready. Conversation rows have not rendered yet.",
                "warning"
            );
        }
    }

    function init() {
        if (!location.pathname.startsWith("/chat")) {
            return;
        }

        window.setTimeout(createPanel, CONFIG.initialDelayMs);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init, {
            once: true,
        });
    } else {
        init();
    }
})();
