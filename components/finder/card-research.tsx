import { cardResearchCaption, factsForSection, sourceForFact, type CardResearch, type CardResearchFact, type CardResearchSource, type CardResearchSection } from "@/lib/card-research-model";
import { cardResearchFactLabel, cardResearchFactValue, partitionCardResearchFacts } from "@/lib/card-research-view";

export function CardResearchCitation({ source }: { source: CardResearchSource }) {
  return <span className="finder-research-citation"><a href={source.url} title={source.title} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{cardResearchCaption(source)}</a></span>;
}

export function CardResearchRows({ profile, section, facts }: { profile: CardResearch; section: CardResearchSection; facts?: readonly CardResearchFact[] }) {
  const rows = facts ?? factsForSection(profile, section);
  const { primary, details } = partitionCardResearchFacts(rows);
  const render = (facts: readonly CardResearchFact[]) => facts.map(fact => {
    const source = sourceForFact(profile, fact);
    return <div className="finder-fact finder-research-fact" key={fact.id}>
      <dt>{cardResearchFactLabel(fact)}{(fact.scope === "building" || fact.field === "facilityAccessibility") && <span className="finder-research-scope">Building information</span>}</dt>
      <dd><span className={section === "passcodes" && fact.field === "passcode" ? "finder-research-code" : undefined}>{cardResearchFactValue(fact, source)}</span>
        {fact.context && <span className="finder-research-context">{fact.context}</span>}
        {source && <CardResearchCitation source={source} />}
      </dd>
    </div>;
  });
  return <>{render(primary)}{details.length > 0 && <div className="finder-research-additional"><dt>Inspection details</dt><dd>
    <details><summary>{section === "amenities" ? "View room fixtures" : "View room features and issues"} ({details.length})</summary><dl>{render(details)}</dl></details>
  </dd></div>}</>;
}

export function CardResearchComments({ profile }: { profile: CardResearch }) {
  if (!profile.comments.length) return null;
  return <div className="finder-research-comments" aria-label="Published comments">{profile.comments.map(comment => {
    const source = profile.sources.find(source => source.id === comment.sourceID);
    return <article className="finder-research-comment" key={comment.id}>
      <p className="finder-research-comment-author">Anonymous{source && <CardResearchCitation source={source} />}</p>
      <p>{comment.text}</p>
    </article>;
  })}</div>;
}
