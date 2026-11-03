import { renderCards, type InlineRun } from "@/lib/renderCards";

/**
 * One assistant reply, rendered as a card.
 *
 * The tree is built from typed blocks by `renderCards`; nothing here ever
 * touches `dangerouslySetInnerHTML`. Every text surface carries
 * `overflow-wrap: anywhere` and `min-w-0`, so even the 5,000-character unbroken
 * token the renderer split for us cannot push the card or the page wider than
 * its container. The left rule is the founder's lime marker for Koko's voice.
 */
function Runs({ runs }: { runs: InlineRun[] }) {
  return (
    <>
      {runs.map((run, index) =>
        run.kind === "bold" ? (
          <strong key={index} className="font-semibold text-pure-white">
            {run.text}
          </strong>
        ) : (
          <span key={index}>{run.text}</span>
        ),
      )}
    </>
  );
}

export default function CardMessage({
  markdown,
  label = "Koko",
}: {
  markdown: string;
  label?: string;
}) {
  const blocks = renderCards(markdown);

  return (
    <article
      aria-label={`${label} reply`}
      className="card w-full min-w-0 max-w-full overflow-hidden px-4 py-3.5 text-[13px] leading-relaxed text-pure-white sm:px-5"
    >
      <div className="min-w-0 border-l-2 border-limelight pl-3 sm:pl-4">
        {blocks.length ? (
          <div className="min-w-0 space-y-2.5">
            {blocks.map((block, index) => {
              if (block.type === "heading") {
                const Tag = block.level === 2 ? "h3" : "h4";
                return (
                  <Tag
                    key={index}
                    className={`min-w-0 [overflow-wrap:anywhere] font-semibold leading-snug text-pure-white ${
                      block.level === 2 ? "text-[15px]" : "text-[13.5px]"
                    }`}
                  >
                    <Runs runs={block.runs} />
                  </Tag>
                );
              }

              if (block.type === "list") {
                const List = block.ordered ? "ol" : "ul";
                return (
                  <List
                    key={index}
                    className={`min-w-0 space-y-1 pl-5 [overflow-wrap:anywhere] ${
                      block.ordered ? "list-decimal" : "list-disc"
                    }`}
                  >
                    {block.items.map((item, itemIndex) => (
                      <li key={itemIndex} className="min-w-0 pl-0.5">
                        <Runs runs={item} />
                      </li>
                    ))}
                  </List>
                );
              }

              return (
                <p
                  key={index}
                  className="min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]"
                >
                  <Runs runs={block.runs} />
                </p>
              );
            })}
          </div>
        ) : (
          <p className="text-[13px] text-muted-zinc">No reply text.</p>
        )}
      </div>
    </article>
  );
}
