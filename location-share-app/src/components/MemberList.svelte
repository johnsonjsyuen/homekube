<script lang="ts">
  import type { MemberLocation } from '$lib/api/types';
  import MemberCard from './MemberCard.svelte';

  let { members, selectedId, onSelect }: {
    members: MemberLocation[];
    selectedId: string | null;
    onSelect: (id: string) => void;
  } = $props();

  let sorted = $derived.by(() => {
    return [...members].sort((a, b) => {
      // Online first, then by name
      if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
      return a.displayName.localeCompare(b.displayName);
    });
  });
</script>

<div class="member-list">
  <div class="member-list-header">
    <span class="member-list-title">Family</span>
    <span class="member-count">{members.length}</span>
  </div>
  {#each sorted as member (member.memberId)}
    <MemberCard
      {member}
      selected={member.memberId === selectedId}
      onclick={() => onSelect(member.memberId)}
    />
  {/each}
</div>

<style>
  .member-list {
    display: flex;
    flex-direction: column;
  }

  .member-list-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
  }

  .member-list-title {
    font-size: 0.8rem;
    font-weight: 600;
    color: #8b8b9e;
    text-transform: uppercase;
    letter-spacing: 1px;
  }

  .member-count {
    font-size: 0.7rem;
    background: rgba(255, 255, 255, 0.08);
    color: #8b8b9e;
    padding: 2px 8px;
    border-radius: 10px;
  }
</style>
