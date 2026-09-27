export function relevantFollowUps(questions: string[] | undefined): string[] {
  return (questions ?? []).filter(
    (question) =>
      !/^(What does the strongest evidence here actually establish\?|What would change this conclusion\?|Summarise what .+ say on this\.)$/.test(
        question,
      ),
  );
}
