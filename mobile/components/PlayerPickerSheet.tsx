import { useMemo, useState } from "react";
import { FlatList, Modal, StyleSheet, Text, View } from "react-native";
import { colors, spacing } from "../constants/theme";
import { IconButton } from "./IconButton";
import { SearchInput } from "./SearchInput";
import { PlayerListItem } from "./PlayerListItem";

export interface PickablePlayer {
  id: number;
  name: string;
  position: string;
  teamId: number;
  teamName: string;
  /** Real provider-reported injury designation, or null/undefined for none — never "OUT" (excluded server-side before reaching this list). */
  injuryStatus?: string | null;
}

interface PlayerPickerSheetProps {
  visible: boolean;
  title: string;
  players: PickablePlayer[];
  /** The other slot's current pick, if any — shown as disabled, never hidden, to make it obvious why it can't be tapped. */
  excludePlayerId: number | null;
  onSelect: (playerId: number) => void;
  onClose: () => void;
}

/**
 * A searchable, virtualized full-eligible-player list — every player associated with the
 * game is listed here, any position, either team. Position is shown for information only;
 * nothing here filters by it. See docs/phase12-mobile-entry-flow.md.
 */
export function PlayerPickerSheet({ visible, title, players, excludePlayerId, onSelect, onClose }: PlayerPickerSheetProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return players;
    return players.filter((p) => p.name.toLowerCase().includes(q) || p.teamName.toLowerCase().includes(q));
  }, [players, query]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          <IconButton name="close" accessibilityLabel="Close" variant="filled" onPress={onClose} />
        </View>

        <View style={styles.searchWrap}>
          <SearchInput placeholder="Search players or teams" value={query} onChangeText={setQuery} accessibilityLabel="Search players" />
        </View>

        {players.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No players available for this game yet.</Text>
          </View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(item) => String(item.id)}
            initialNumToRender={20}
            maxToRenderPerBatch={20}
            windowSize={7}
            removeClippedSubviews
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={<Text style={styles.emptyText}>No players match &ldquo;{query}&rdquo;.</Text>}
            renderItem={({ item }) => {
              const disabled = item.id === excludePlayerId;
              return (
                <PlayerListItem
                  name={item.name}
                  teamName={item.teamName}
                  position={item.position}
                  injuryStatus={item.injuryStatus}
                  disabled={disabled}
                  accessibilityLabel={`${item.name}, ${item.teamName}, ${item.position}${disabled ? ", already selected for the other pick" : ""}`}
                  onPress={() => {
                    onSelect(item.id);
                    onClose();
                  }}
                />
              );
            }}
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, paddingTop: spacing.lg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  title: { color: colors.foreground, fontSize: 18, fontWeight: "800" },
  searchWrap: { paddingHorizontal: spacing.lg, marginBottom: spacing.md },
  empty: { padding: spacing.xxl, alignItems: "center" },
  emptyText: { color: colors.muted, fontSize: 14, textAlign: "center", padding: spacing.lg },
});
