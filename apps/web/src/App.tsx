import {
  Bell as BellIcon,
  Check as CheckIcon,
  ChevronLeft as ChevronLeftIcon,
  CircleHelp as CircleHelpIcon,
  HandHeart as HandHeartIcon,
  Home as HomeIcon,
  Inbox as InboxIcon,
  Lock as LockIcon,
  Plus as PlusIcon,
  RadioTower as RadioTowerIcon,
  Search as SearchIcon,
  Send as SendIcon,
  Shield as ShieldIcon,
  Trash2 as Trash2Icon,
  User as UserIcon,
  Users as UsersIcon,
  X as XIcon,
  type LucideProps,
} from "lucide-react";
import { type ReactElement, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  MAX_PUBLIC_TEXT_CODE_POINTS,
  unicodeLength,
  type CommonThreadEvent,
  type ThreadCreatedBody,
  type ThreadCreatedType,
} from "@core/Domain/CommonThreadEvent";
import { ContentSafetyPolicy } from "@core/Domain/ContentSafetyPolicy";
import { compareEventOrder } from "@core/Domain/ThreadReducer";
import type { MaterialisedThread } from "@core/Domain/ThreadState";
import type { MeshStatus } from "@core/Transport/LanRelayMeshTransport";
import type { PublishResult } from "@core/Services/CommonThreadService";
import { OVERLAY_ID, PhoneFrame } from "./components/PhoneFrame";
import { JoinPanel } from "./components/JoinPanel";
import { useCommonThread, type CommonThreadRuntime } from "./mesh/useCommonThread";

type IconComponent = (props: LucideProps) => ReactElement;

const Bell = BellIcon as IconComponent;
const Check = CheckIcon as IconComponent;
const ChevronLeft = ChevronLeftIcon as IconComponent;
const CircleHelp = CircleHelpIcon as IconComponent;
const HandHeart = HandHeartIcon as IconComponent;
const Home = HomeIcon as IconComponent;
const Inbox = InboxIcon as IconComponent;
const Lock = LockIcon as IconComponent;
const Plus = PlusIcon as IconComponent;
const RadioTower = RadioTowerIcon as IconComponent;
const Search = SearchIcon as IconComponent;
const Send = SendIcon as IconComponent;
const Shield = ShieldIcon as IconComponent;
const Trash2 = Trash2Icon as IconComponent;
const User = UserIcon as IconComponent;
const Users = UsersIcon as IconComponent;
const X = XIcon as IconComponent;

type Tab = "nearby" | "activity" | "guidance" | "me";
type FeedFilter = "all" | "request" | "offer";

const areaName = "Riverside Estate";
const safety = new ContentSafetyPolicy();

const categoryLabels: Record<string, string> = {
  power: "Power",
  supplies: "Supplies",
  access: "Access",
  checkin: "Check-in",
  guidance: "Guidance",
};

const guidanceCards = [
  {
    title: "Keeping a phone charged",
    source: "Local resilience pack",
    reviewed: "15 Aug 2026",
    when: "Use this when power is intermittent and people are sharing sockets or battery packs.",
    text: "Keep one device switched off as a reserve, lower brightness, and avoid posting contact details publicly.",
  },
  {
    title: "Checking in on a neighbour",
    source: "Community volunteer handbook",
    reviewed: "15 Aug 2026",
    when: "Use this before knocking or asking others to check on someone nearby.",
    text: "Ask for consent, keep public updates general, and do not share medical details in a thread.",
  },
  {
    title: "When to contact official services",
    source: "Council emergency advice",
    reviewed: "14 Aug 2026",
    when: "Use this when a situation may need trained support or an official welfare response.",
    text: "Common Thread does not dispatch services. If there is immediate danger, use the official emergency route available in your area.",
  },
];

function elapsed(iso: string) {
  const diff = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (diff < 60) return `${diff}m`;
  if (diff < 1440) return `${Math.round(diff / 60)}h`;
  return `${Math.round(diff / 1440)}d`;
}

function displayStatus(thread: MaterialisedThread) {
  if (thread.root.type === "offer") {
    return thread.status === "Open"
      ? "Available"
      : thread.status === "Resolved"
        ? "Closed"
        : "Matched";
  }
  if (thread.root.type === "update") {
    return thread.status === "Open" ? "Current" : "Resolved";
  }
  return thread.status;
}

function bodyOf<T>(event: CommonThreadEvent) {
  return event.body as T;
}

export function App() {
  const runtime = useCommonThread();
  const [tab, setTab] = useState<Tab>("nearby");
  const [openThreadID, setOpenThreadID] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(timer);
  }, [toast]);

  /** Surfaces authoriser rejections instead of silently dropping them. */
  const report = useCallback((result: PublishResult, success: string) => {
    if (!result.accepted) {
      setToast(result.rejectionReason ?? "This action is not allowed");
      return false;
    }
    setToast(result.deliveryState === "queued" ? "Queued — mesh offline" : success);
    return true;
  }, []);

  const openThread =
    runtime.threads.find((thread) => thread.threadID === openThreadID) ?? null;

  return (
    <div className="stage">
      <JoinPanel status={runtime.status} />
      <PhoneFrame>
        {!runtime.displayName ? (
          <Onboarding onSubmit={runtime.setDisplayName} />
        ) : !runtime.ready ? (
          <div className="screen centred">
            <p className="join-hint">Opening local store…</p>
          </div>
        ) : (
          <>
            <MeshHeader status={runtime.status} />
            {toast && (
              <p className="toast" role="status">
                {toast}
              </p>
            )}
            <div className="stack">
              <div className={`stack-layer ${openThread ? "behind" : ""}`}>
                {tab === "nearby" && (
                  <Nearby
                    runtime={runtime}
                    onOpen={setOpenThreadID}
                    report={report}
                  />
                )}
                {tab === "activity" && (
                  <Activity runtime={runtime} onOpen={setOpenThreadID} />
                )}
                {tab === "guidance" && (
                  <Guidance runtime={runtime} report={report} />
                )}
                {tab === "me" && <Me runtime={runtime} setToast={setToast} />}
              </div>
              {openThread && (
                <div className="stack-layer front">
                  <ThreadDetail
                    thread={openThread}
                    runtime={runtime}
                    report={report}
                    onBack={() => setOpenThreadID(null)}
                  />
                </div>
              )}
            </div>
            <nav className="tabs" aria-label="Primary">
              <TabButton
                active={tab === "nearby"}
                onClick={() => {
                  setTab("nearby");
                  setOpenThreadID(null);
                }}
                icon={<Home size={20} />}
                label="Nearby"
              />
              <TabButton
                active={tab === "activity"}
                onClick={() => {
                  setTab("activity");
                  setOpenThreadID(null);
                }}
                icon={<Inbox size={20} />}
                label="Activity"
              />
              <TabButton
                active={tab === "guidance"}
                onClick={() => {
                  setTab("guidance");
                  setOpenThreadID(null);
                }}
                icon={<CircleHelp size={20} />}
                label="Guidance"
              />
              <TabButton
                active={tab === "me"}
                onClick={() => {
                  setTab("me");
                  setOpenThreadID(null);
                }}
                icon={<User size={20} />}
                label="Me"
              />
            </nav>
          </>
        )}
      </PhoneFrame>
    </div>
  );
}

function Onboarding({ onSubmit }: { onSubmit: (name: string) => void }) {
  const [name, setName] = useState("");
  return (
    <section className="screen onboarding">
      <RadioTower size={34} />
      <h1>Common Thread</h1>
      <p>
        A local mutual-aid mesh for {areaName}. No account, no cloud — your
        posts stay on the devices nearby.
      </p>
      <label className="field">
        <span>What should neighbours call you?</span>
        <input
          value={name}
          maxLength={24}
          onChange={(event) => setName(event.target.value)}
          placeholder="First name or nickname"
          aria-label="Display name"
        />
      </label>
      <button
        className="primary"
        disabled={!name.trim()}
        onClick={() => onSubmit(name.trim())}
      >
        Join the mesh
      </button>
      <p className="fineprint">
        A nickname is stored on this device only. Never post phone numbers,
        addresses or health details in a public thread.
      </p>
    </section>
  );
}

/**
 * Reports upstream/outbox state only (PLD-04). It never claims delivery to a
 * peer, because the transport cannot know that.
 */
function MeshHeader({ status }: { status: MeshStatus }) {
  const label =
    status.connection === "online"
      ? status.peers.length === 1
        ? "Local mesh · 1 nearby"
        : `Local mesh · ${status.peers.length} nearby`
      : status.connection === "connecting"
        ? "Connecting to mesh"
        : status.queued > 0
          ? `Mesh offline — ${status.queued} queued`
          : "Mesh offline";
  return (
    <header className="mesh-header">
      <div>
        <p className="eyebrow">{areaName}</p>
        <span className={`mesh-pill ${status.connection}`}>
          <Users size={14} />
          {label}
        </span>
      </div>
    </header>
  );
}

function TabButton(props: {
  active: boolean;
  onClick: () => void;
  icon: JSX.Element;
  label: string;
}) {
  return (
    <button
      className={`tab ${props.active ? "active" : ""}`}
      onClick={props.onClick}
      aria-current={props.active ? "page" : undefined}
    >
      {props.icon}
      <span>{props.label}</span>
    </button>
  );
}

function Nearby(props: {
  runtime: CommonThreadRuntime;
  onOpen: (threadID: string) => void;
  report: (result: PublishResult, success: string) => boolean;
}) {
  const [filter, setFilter] = useState<FeedFilter>("all");
  const [composer, setComposer] = useState<ThreadCreatedType | null>(null);

  const visible = props.runtime.threads
    .filter((thread) => filter === "all" || thread.root.type === filter)
    .sort((a, b) => Date.parse(b.root.createdAt) - Date.parse(a.root.createdAt));

  return (
    <section className="screen">
      <div className="segmented" role="tablist" aria-label="Nearby filters">
        {(["all", "request", "offer"] as FeedFilter[]).map((item) => (
          <button
            key={item}
            role="tab"
            aria-selected={filter === item}
            className={filter === item ? "selected" : ""}
            onClick={() => setFilter(item)}
          >
            {item === "all" ? "All" : item === "request" ? "Requests" : "Offers"}
          </button>
        ))}
      </div>

      <div className="compose-row">
        <button onClick={() => setComposer("request")}>
          <HandHeart size={16} /> Ask
        </button>
        <button onClick={() => setComposer("offer")}>
          <Plus size={16} /> Offer
        </button>
        <button onClick={() => setComposer("update")}>
          <Bell size={16} /> Update
        </button>
      </div>

      <div className="thread-list">
        {visible.length === 0 ? (
          <p className="empty">
            Nothing nearby yet. Post the first request or offer.
          </p>
        ) : (
          visible.map((thread) => (
            <ThreadCard
              key={thread.threadID}
              thread={thread}
              author={props.runtime.nameFor(thread.root.authorPeerID)}
              onClick={() => props.onOpen(thread.threadID)}
            />
          ))
        )}
      </div>

      {composer && (
        <Composer
          mode={composer}
          close={() => setComposer(null)}
          submit={async (input) => {
            const service = props.runtime.service;
            if (!service) return false;
            const result = await service.createThread({
              ...input,
              type: composer,
            });
            return props.report(result, "Shared on the mesh");
          }}
        />
      )}
    </section>
  );
}

function ThreadCard(props: {
  thread: MaterialisedThread;
  author: string;
  onClick: () => void;
}) {
  const kind =
    props.thread.root.type === "request"
      ? "Request"
      : props.thread.root.type === "offer"
        ? "Offer"
        : "Update";
  return (
    <button className="thread-card" onClick={props.onClick}>
      <div className="card-topline">
        <span className={`kind ${props.thread.root.type}`}>{kind}</span>
        <span className="status">
          <Check size={13} /> {displayStatus(props.thread)}
        </span>
      </div>
      <h2>{props.thread.root.title}</h2>
      <p>{props.thread.root.text}</p>
      <div className="meta">
        <span>{props.author}</span>
        <span>{props.thread.root.roughPlace}</span>
        <span>{elapsed(props.thread.root.createdAt)} ago</span>
        {props.thread.replies.length > 0 && (
          <span>{props.thread.replies.length} replies</span>
        )}
      </div>
    </button>
  );
}

function ThreadDetail(props: {
  thread: MaterialisedThread;
  runtime: CommonThreadRuntime;
  report: (result: PublishResult, success: string) => boolean;
  onBack: () => void;
}) {
  const { thread, runtime } = props;
  const [replyText, setReplyText] = useState("");
  const [pendingUnsafeReply, setPendingUnsafeReply] = useState<string | null>(
    null,
  );
  const [offerComposer, setOfferComposer] = useState(false);

  const timeline = runtime.events
    .filter(
      (event) =>
        event.threadID === thread.threadID &&
        event.eventID !== thread.root.eventID,
    )
    .sort(compareEventOrder);

  const isRootAuthor = thread.root.authorPeerID === runtime.peerID;
  const chars = unicodeLength(replyText);

  async function submitReply(text: string) {
    const service = runtime.service;
    if (!service) return;
    const result = await service.reply(thread.threadID, text);
    if (props.report(result, "Reply shared")) {
      setReplyText("");
    }
  }

  function attemptReply() {
    const text = replyText.trim();
    if (!text) return;
    if (unicodeLength(text) > MAX_PUBLIC_TEXT_CODE_POINTS) return;
    if (safety.inspectText(text).length > 0) {
      setPendingUnsafeReply(text);
      return;
    }
    void submitReply(text);
  }

  return (
    <section className="screen detail" aria-label="Thread detail">
      <div className="detail-nav">
        <button className="back" onClick={props.onBack}>
          <ChevronLeft size={20} /> Nearby
        </button>
      </div>

      <article className="header-card">
        <div className="card-topline">
          <span className={`kind ${thread.root.type}`}>{thread.root.type}</span>
          <span className="status">
            <Check size={13} /> {displayStatus(thread)}
          </span>
        </div>
        <h2>{thread.root.title}</h2>
        <p className="meta-line">
          {runtime.nameFor(thread.root.authorPeerID)} · {thread.root.roughPlace}{" "}
          · {elapsed(thread.root.createdAt)} ago ·{" "}
          {categoryLabels[thread.root.category] ?? thread.root.category}
        </p>
        <p className="quote">{thread.root.text}</p>
        {thread.safetyWarnings.length > 0 && (
          <p className="warning">
            <Shield size={15} /> This post may contain details that are safer
            kept private.
          </p>
        )}
        <div className="action-line">
          {thread.root.type === "request" && !isRootAuthor && (
            <button className="primary" onClick={() => setOfferComposer(true)}>
              Offer help
            </button>
          )}
          {isRootAuthor && thread.status !== "Resolved" && (
            <button
              className="secondary"
              onClick={async () => {
                const service = runtime.service;
                if (!service) return;
                props.report(
                  await service.resolve(
                    thread.threadID,
                    "Resolved by request creator",
                  ),
                  "Thread resolved",
                );
              }}
            >
              Resolve
            </button>
          )}
        </div>
      </article>

      <div className="messages-list">
        {timeline.map((event) => (
          <TimelineEvent
            key={event.eventID}
            event={event}
            thread={thread}
            runtime={runtime}
            canAccept={isRootAuthor && thread.status === "Open"}
            report={props.report}
          />
        ))}
      </div>

      <div className="public-composer">
        <span className="context-chip">
          Replying publicly to “{thread.root.title}”
        </span>
        <div className="input-row">
          <textarea
            value={replyText}
            maxLength={MAX_PUBLIC_TEXT_CODE_POINTS}
            onChange={(event) => setReplyText(event.target.value)}
            placeholder="Add a useful public update…"
            aria-label="Add a useful public update"
          />
          <button
            className="send-button"
            onClick={attemptReply}
            aria-label="Send public reply"
          >
            <Send size={18} />
          </button>
        </div>
        <p className="footer-copy">
          {chars}/{MAX_PUBLIC_TEXT_CODE_POINTS} · public to everyone nearby
        </p>
      </div>

      {pendingUnsafeReply && (
        <Sheet
          label="Confirm public reply"
          onClose={() => setPendingUnsafeReply(null)}
        >
          <Shield size={22} />
          <h2>Send this publicly?</h2>
          <p>
            This reply looks like it contains a phone number, address or health
            detail. Everyone nearby will see it.
          </p>
          <button
            className="primary"
            onClick={() => {
              const text = pendingUnsafeReply;
              setPendingUnsafeReply(null);
              void submitReply(text);
            }}
          >
            Send publicly anyway
          </button>
          <button
            className="secondary"
            onClick={() => setPendingUnsafeReply(null)}
          >
            Edit first
          </button>
        </Sheet>
      )}

      {offerComposer && (
        <Composer
          mode="offer"
          close={() => setOfferComposer(false)}
          submit={async (input) => {
            const service = runtime.service;
            if (!service) return false;
            return props.report(
              await service.postOffer(thread.threadID, input),
              "Offer shared",
            );
          }}
        />
      )}
    </section>
  );
}

function TimelineEvent(props: {
  event: CommonThreadEvent;
  thread: MaterialisedThread;
  runtime: CommonThreadRuntime;
  canAccept: boolean;
  report: (result: PublishResult, success: string) => boolean;
}) {
  const { event, thread, runtime } = props;

  if (event.kind === "thread.reply.created") {
    const body = bodyOf<{ text: string }>(event);
    const mine = event.authorPeerID === runtime.peerID;
    return (
      <div className={`bubble ${mine ? "outgoing" : "incoming"}`}>
        {!mine && <strong>{runtime.nameFor(event.authorPeerID)}</strong>}
        <p>{body.text}</p>
        <small>{elapsed(event.createdAt)} ago</small>
      </div>
    );
  }

  if (
    event.kind === "thread.created" &&
    bodyOf<ThreadCreatedBody>(event).type === "offer" &&
    event.eventID !== thread.root.eventID
  ) {
    const body = bodyOf<ThreadCreatedBody>(event);
    const accepted = thread.acceptedOfferEventID === event.eventID;
    return (
      <div className="offer-cell">
        <div>
          <span className="kind offer">Offer</span>
          <h3>{body.title}</h3>
          <p>{body.text}</p>
          <small>
            {runtime.nameFor(event.authorPeerID)} · {body.roughPlace}
          </small>
        </div>
        {props.canAccept && (
          <button
            className="primary compact"
            onClick={async () => {
              const service = runtime.service;
              if (!service) return;
              props.report(
                await service.acceptOffer(thread.threadID, event.eventID),
                "Offer accepted",
              );
            }}
          >
            Accept offer
          </button>
        )}
        {accepted && (
          <span className="status">
            <Check size={13} /> Accepted
          </span>
        )}
      </div>
    );
  }

  if (event.kind === "thread.offer.accepted") {
    return <p className="system-line">Offer accepted</p>;
  }
  if (event.kind === "thread.resolved") {
    return <p className="system-line">Thread resolved</p>;
  }
  return null;
}

function Composer(props: {
  mode: ThreadCreatedType;
  close: () => void;
  submit: (input: Omit<ThreadCreatedBody, "type">) => Promise<boolean>;
}) {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [roughPlace, setRoughPlace] = useState("");
  const [category, setCategory] = useState("supplies");
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);

  const warnings = safety.inspectText([title, text, roughPlace].join(" "));
  const count = unicodeLength(text);
  const label =
    props.mode === "request"
      ? "Ask for help"
      : props.mode === "offer"
        ? "Offer help"
        : "Share an update";

  async function submit() {
    if (!title.trim() || !text.trim() || !roughPlace.trim()) return;
    if (count > MAX_PUBLIC_TEXT_CODE_POINTS) return;
    if (warnings.length > 0 && !acknowledged) {
      setAcknowledged(true);
      return;
    }
    setBusy(true);
    const ok = await props.submit({
      title: title.trim(),
      text: text.trim(),
      roughPlace: roughPlace.trim(),
      category,
    });
    setBusy(false);
    if (ok) props.close();
  }

  return (
    <Sheet label={label} onClose={props.close} className="composer-sheet">
      <h2>{label}</h2>
      <input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        maxLength={80}
        placeholder="Plain title"
        aria-label="Plain title"
      />
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        maxLength={MAX_PUBLIC_TEXT_CODE_POINTS}
        placeholder="What should nearby people know?"
        aria-label="Post text"
      />
      <div className="two-col">
        <input
          value={roughPlace}
          onChange={(event) => setRoughPlace(event.target.value)}
          maxLength={60}
          placeholder="Rough place"
          aria-label="Rough place"
        />
        <select
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          aria-label="Category"
        >
          <option value="supplies">Supplies</option>
          <option value="power">Power</option>
          <option value="access">Access</option>
          <option value="checkin">Check-in</option>
        </select>
      </div>
      {acknowledged && warnings.length > 0 && (
        <p className="warning">
          <Shield size={15} /> This may include contact details, an exact
          address or a health detail.
        </p>
      )}
      <div className="sheet-actions">
        <span>
          {count}/{MAX_PUBLIC_TEXT_CODE_POINTS}
        </span>
        <button className="primary" disabled={busy} onClick={submit}>
          {acknowledged && warnings.length > 0 ? "Post publicly anyway" : label}
        </button>
      </div>
    </Sheet>
  );
}

function Activity(props: {
  runtime: CommonThreadRuntime;
  onOpen: (threadID: string) => void;
}) {
  const { runtime } = props;
  const mine = useMemo(() => {
    const involved = new Set(
      runtime.events
        .filter((event) => event.authorPeerID === runtime.peerID)
        .map((event) => event.threadID),
    );
    return runtime.threads
      .filter((thread) => involved.has(thread.threadID))
      .sort(
        (a, b) => Date.parse(b.root.createdAt) - Date.parse(a.root.createdAt),
      );
  }, [runtime.events, runtime.threads, runtime.peerID]);

  const matched = mine.filter((thread) => thread.status === "Matched");

  return (
    <section className="screen">
      <h2 className="screen-title">Your activity</h2>
      {mine.length === 0 ? (
        <p className="empty">
          Threads you post in or reply to will show up here.
        </p>
      ) : (
        <div className="thread-list">
          {mine.map((thread) => (
            <ThreadCard
              key={thread.threadID}
              thread={thread}
              author={runtime.nameFor(thread.root.authorPeerID)}
              onClick={() => props.onOpen(thread.threadID)}
            />
          ))}
        </div>
      )}

      <div className="private-block">
        <h3>
          <Lock size={15} /> Private chat
        </h3>
        {matched.length === 0 ? (
          <p className="join-hint">
            Opens once an offer is accepted. Contact details never go in a
            public thread.
          </p>
        ) : (
          <p className="join-hint">
            {matched.length} matched {matched.length === 1 ? "thread" : "threads"}
            . Encrypted 1:1 messaging runs on the phone companion's Noise
            sessions — it is not available over this local-network demo.
          </p>
        )}
      </div>
    </section>
  );
}

function Guidance(props: {
  runtime: CommonThreadRuntime;
  report: (result: PublishResult, success: string) => boolean;
}) {
  const [search, setSearch] = useState("");
  const cards = guidanceCards.filter((card) =>
    `${card.title} ${card.when}`.toLowerCase().includes(search.toLowerCase()),
  );
  // guidance.shared events are area bulletins, not threads, so they are read
  // straight off the event log rather than the reducer.
  const bulletins = props.runtime.events
    .filter((event) => event.kind === "guidance.shared")
    .sort(compareEventOrder)
    .reverse();

  return (
    <section className="screen">
      <label className="search-field">
        <Search size={17} />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search guidance"
          aria-label="Search guidance"
        />
      </label>

      {bulletins.length > 0 && (
        <div className="bulletins">
          <h3>Shared nearby</h3>
          {bulletins.map((event) => {
            const body = bodyOf<{ title: string; text: string }>(event);
            return (
              <article className="bulletin" key={event.eventID}>
                <strong>{body.title}</strong>
                <p>{body.text}</p>
                <small>
                  {props.runtime.nameFor(event.authorPeerID)} ·{" "}
                  {elapsed(event.createdAt)} ago
                </small>
              </article>
            );
          })}
        </div>
      )}

      <div className="guidance-list">
        {cards.map((card) => (
          <article className="guidance-card" key={card.title}>
            <div>
              <h2>{card.title}</h2>
              <p>{card.when}</p>
              <small>
                {card.source} · Reviewed {card.reviewed}
              </small>
            </div>
            <button
              className="secondary"
              onClick={async () => {
                const service = props.runtime.service;
                if (!service) return;
                props.report(
                  await service.shareGuidance({
                    title: card.title,
                    text: card.text,
                  }),
                  "Guidance shared nearby",
                );
              }}
            >
              Share to Nearby
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

function Me(props: {
  runtime: CommonThreadRuntime;
  setToast: (message: string) => void;
}) {
  const { runtime } = props;
  const [showWall, setShowWall] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const stats = useMemo(
    () => ({
      requests: runtime.threads.filter(
        (t) => t.root.type === "request" && t.status === "Open",
      ).length,
      offers: runtime.threads.filter(
        (t) => t.root.type === "offer" && t.status === "Open",
      ).length,
      matched: runtime.threads.filter((t) => t.status === "Matched").length,
      resolved: runtime.threads.filter((t) => t.status === "Resolved").length,
    }),
    [runtime.threads],
  );

  if (showWall) {
    return (
      <section className="screen wall-mode">
        <button className="secondary" onClick={() => setShowWall(false)}>
          Exit Wall Mode
        </button>
        <div className="stat-grid">
          <Stat label="Open requests" value={stats.requests} />
          <Stat label="Active offers" value={stats.offers} />
          <Stat label="Matched support" value={stats.matched} />
          <Stat label="Resolved threads" value={stats.resolved} />
        </div>
      </section>
    );
  }

  return (
    <section className="screen">
      <article className="profile-card">
        <span className="avatar large">
          {(runtime.displayName[0] ?? "?").toUpperCase()}
        </span>
        <div>
          <h2>{runtime.displayName}</h2>
          <p>Local-only profile · {runtime.peerID}</p>
        </div>
      </article>

      <div className="settings-list">
        <div className="setting-row">
          <Shield size={18} />
          <span>Events stay in this browser's local store</span>
        </div>
        <div className="setting-row">
          <RadioTower size={18} />
          <span>
            {runtime.status.connection === "online"
              ? `Local-network mesh · ${runtime.status.peers.length} nearby`
              : `Mesh offline · ${runtime.status.queued} queued`}
          </span>
        </div>
        <button onClick={() => setShowWall(true)}>
          <Users size={18} /> Wall Mode
        </button>
        <button className="danger" onClick={() => setConfirmClear(true)}>
          <Trash2 size={18} /> Clear local data
        </button>
      </div>

      <p className="fineprint">
        This demo relays over the local network, not Bluetooth — browsers cannot
        act as BLE peripherals. The BLE mesh lives in the phone companion.
      </p>

      {confirmClear && (
        <Sheet label="Confirm clear local data" onClose={() => setConfirmClear(false)}>
          <h2>Clear local data?</h2>
          <p>
            This wipes only this device's copy. Events already relayed to other
            devices are append-only and stay there.
          </p>
          <button
            className="danger solid"
            onClick={async () => {
              await runtime.clearLocalData();
              setConfirmClear(false);
              props.setToast("Local store cleared");
            }}
          >
            Clear local data
          </button>
          <button className="secondary" onClick={() => setConfirmClear(false)}>
            Cancel
          </button>
        </Sheet>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <article className="stat">
      <strong>{value}</strong>
      <span>{label}</span>
    </article>
  );
}

function Sheet(props: {
  label: string;
  onClose: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => setHost(document.getElementById(OVERLAY_ID)), []);
  if (!host) {
    return null;
  }
  return createPortal(
    <div className="sheet-backdrop" role="presentation">
      <section
        className={`sheet ${props.className ?? ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={props.label}
      >
        <button
          className="icon-button close"
          onClick={props.onClose}
          aria-label="Close"
        >
          <X size={18} />
        </button>
        {props.children}
      </section>
    </div>,
    host,
  );
}
