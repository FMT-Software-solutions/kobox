export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      allocations: {
        Row: {
          amount: number
          created_at: string
          id: string
          obligation_id: string | null
          payment_id: string
          plan_id: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          obligation_id?: string | null
          payment_id: string
          plan_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          obligation_id?: string | null
          payment_id?: string
          plan_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "allocations_obligation_id_fkey"
            columns: ["obligation_id"]
            isOneToOne: false
            referencedRelation: "obligation_balances"
            referencedColumns: ["obligation_id"]
          },
          {
            foreignKeyName: "allocations_obligation_id_fkey"
            columns: ["obligation_id"]
            isOneToOne: false
            referencedRelation: "obligations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "allocations_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "allocations_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plan_summaries"
            referencedColumns: ["plan_id"]
          },
          {
            foreignKeyName: "allocations_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      app_config: {
        Row: {
          dispatch_secret: string | null
          dispatch_url: string | null
          id: boolean
          updated_at: string
        }
        Insert: {
          dispatch_secret?: string | null
          dispatch_url?: string | null
          id?: boolean
          updated_at?: string
        }
        Update: {
          dispatch_secret?: string | null
          dispatch_url?: string | null
          id?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      cycles: {
        Row: {
          created_at: string
          due_date: string
          id: string
          label: string
          period_end: string
          period_start: string
          plan_id: string
          status: Database["public"]["Enums"]["cycle_status"]
        }
        Insert: {
          created_at?: string
          due_date: string
          id?: string
          label: string
          period_end: string
          period_start: string
          plan_id: string
          status?: Database["public"]["Enums"]["cycle_status"]
        }
        Update: {
          created_at?: string
          due_date?: string
          id?: string
          label?: string
          period_end?: string
          period_start?: string
          plan_id?: string
          status?: Database["public"]["Enums"]["cycle_status"]
        }
        Relationships: [
          {
            foreignKeyName: "cycles_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plan_summaries"
            referencedColumns: ["plan_id"]
          },
          {
            foreignKeyName: "cycles_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          amount: number
          approved_by: string | null
          category: string
          created_at: string
          group_id: string
          id: string
          note: string | null
          receipt_url: string | null
          recorded_by: string
          spent_at: string
          status: Database["public"]["Enums"]["expense_status"]
          title: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          amount: number
          approved_by?: string | null
          category?: string
          created_at?: string
          group_id: string
          id?: string
          note?: string | null
          receipt_url?: string | null
          recorded_by: string
          spent_at?: string
          status?: Database["public"]["Enums"]["expense_status"]
          title: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          amount?: number
          approved_by?: string | null
          category?: string
          created_at?: string
          group_id?: string
          id?: string
          note?: string | null
          receipt_url?: string | null
          recorded_by?: string
          spent_at?: string
          status?: Database["public"]["Enums"]["expense_status"]
          title?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expenses_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "group_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "member_standings"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "expenses_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "pending_join_requests"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "expenses_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "user_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "group_summaries"
            referencedColumns: ["group_id"]
          },
          {
            foreignKeyName: "expenses_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "group_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "member_standings"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "expenses_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "pending_join_requests"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "expenses_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "user_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "group_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "member_standings"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "expenses_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "pending_join_requests"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "expenses_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "user_organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      expo_push_tokens: {
        Row: {
          created_at: string
          id: string
          last_seen_at: string
          platform: string
          token: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_seen_at?: string
          platform: string
          token: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_seen_at?: string
          platform?: string
          token?: string
          user_id?: string
        }
        Relationships: []
      }
      group_members: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string
          group_id: string
          id: string
          joined_at: string
          phone: string | null
          phone_e164: string | null
          role: Database["public"]["Enums"]["member_role"]
          status: Database["public"]["Enums"]["member_status"]
          updated_at: string
          user_id: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name: string
          group_id: string
          id?: string
          joined_at?: string
          phone?: string | null
          phone_e164?: string | null
          role?: Database["public"]["Enums"]["member_role"]
          status?: Database["public"]["Enums"]["member_status"]
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string
          group_id?: string
          id?: string
          joined_at?: string
          phone?: string | null
          phone_e164?: string | null
          role?: Database["public"]["Enums"]["member_role"]
          status?: Database["public"]["Enums"]["member_status"]
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "group_summaries"
            referencedColumns: ["group_id"]
          },
          {
            foreignKeyName: "group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      group_messages: {
        Row: {
          audience: string
          body: string
          created_at: string
          credits_estimated: number
          group_id: string
          id: string
          push_only: boolean
          recipient_count: number
          sent_by: string | null
          tag_id: string | null
        }
        Insert: {
          audience: string
          body: string
          created_at?: string
          credits_estimated?: number
          group_id: string
          id?: string
          push_only?: boolean
          recipient_count?: number
          sent_by?: string | null
          tag_id?: string | null
        }
        Update: {
          audience?: string
          body?: string
          created_at?: string
          credits_estimated?: number
          group_id?: string
          id?: string
          push_only?: boolean
          recipient_count?: number
          sent_by?: string | null
          tag_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "group_messages_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "group_summaries"
            referencedColumns: ["group_id"]
          },
          {
            foreignKeyName: "group_messages_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_messages_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_messages_sent_by_fkey"
            columns: ["sent_by"]
            isOneToOne: false
            referencedRelation: "group_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_messages_sent_by_fkey"
            columns: ["sent_by"]
            isOneToOne: false
            referencedRelation: "member_standings"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "group_messages_sent_by_fkey"
            columns: ["sent_by"]
            isOneToOne: false
            referencedRelation: "pending_join_requests"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "group_messages_sent_by_fkey"
            columns: ["sent_by"]
            isOneToOne: false
            referencedRelation: "user_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_messages_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tag_summaries"
            referencedColumns: ["tag_id"]
          },
          {
            foreignKeyName: "group_messages_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      groups: {
        Row: {
          brand_colour: string | null
          created_at: string
          created_by: string | null
          currency: string
          description: string | null
          id: string
          join_code: string
          join_code_expires_at: string | null
          join_requires_approval: boolean
          logo_url: string | null
          name: string
          sms_enabled: boolean
          sms_monthly_cap: number
          sms_sender_id: string | null
          timezone: string
          updated_at: string
        }
        Insert: {
          brand_colour?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string | null
          id?: string
          join_code: string
          join_code_expires_at?: string | null
          join_requires_approval?: boolean
          logo_url?: string | null
          name: string
          sms_enabled?: boolean
          sms_monthly_cap?: number
          sms_sender_id?: string | null
          timezone?: string
          updated_at?: string
        }
        Update: {
          brand_colour?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string | null
          id?: string
          join_code?: string
          join_code_expires_at?: string | null
          join_requires_approval?: boolean
          logo_url?: string | null
          name?: string
          sms_enabled?: boolean
          sms_monthly_cap?: number
          sms_sender_id?: string | null
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      member_link_events: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          created_at: string
          group_id: string
          id: string
          kind: string
          member_id: string | null
          member_name: string | null
          phone_e164: string
          user_id: string | null
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          created_at?: string
          group_id: string
          id?: string
          kind: string
          member_id?: string | null
          member_name?: string | null
          phone_e164: string
          user_id?: string | null
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          created_at?: string
          group_id?: string
          id?: string
          kind?: string
          member_id?: string | null
          member_name?: string | null
          phone_e164?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "member_link_events_acknowledged_by_fkey"
            columns: ["acknowledged_by"]
            isOneToOne: false
            referencedRelation: "group_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_link_events_acknowledged_by_fkey"
            columns: ["acknowledged_by"]
            isOneToOne: false
            referencedRelation: "member_standings"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "member_link_events_acknowledged_by_fkey"
            columns: ["acknowledged_by"]
            isOneToOne: false
            referencedRelation: "pending_join_requests"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "member_link_events_acknowledged_by_fkey"
            columns: ["acknowledged_by"]
            isOneToOne: false
            referencedRelation: "user_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_link_events_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "group_summaries"
            referencedColumns: ["group_id"]
          },
          {
            foreignKeyName: "member_link_events_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_link_events_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_link_events_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "group_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_link_events_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "member_standings"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "member_link_events_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "pending_join_requests"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "member_link_events_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "user_organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      member_tags: {
        Row: {
          created_at: string
          member_id: string
          tag_id: string
        }
        Insert: {
          created_at?: string
          member_id: string
          tag_id: string
        }
        Update: {
          created_at?: string
          member_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_tags_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "group_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_tags_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "member_standings"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "member_tags_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "pending_join_requests"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "member_tags_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "user_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tag_summaries"
            referencedColumns: ["tag_id"]
          },
          {
            foreignKeyName: "member_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          member_id: string
          push_enabled: boolean
          reminders_enabled: boolean
          sms_enabled: boolean
          updated_at: string
        }
        Insert: {
          member_id: string
          push_enabled?: boolean
          reminders_enabled?: boolean
          sms_enabled?: boolean
          updated_at?: string
        }
        Update: {
          member_id?: string
          push_enabled?: boolean
          reminders_enabled?: boolean
          sms_enabled?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: true
            referencedRelation: "group_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_preferences_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: true
            referencedRelation: "member_standings"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "notification_preferences_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: true
            referencedRelation: "pending_join_requests"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "notification_preferences_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: true
            referencedRelation: "user_organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          attempts: number
          body: string
          category: string
          created_at: string
          dedupe_key: string
          group_id: string
          id: string
          last_error: string | null
          member_id: string | null
          message_id: string | null
          phone_e164: string | null
          push_sent: boolean
          send_after: string
          sent_at: string | null
          sms_body: string | null
          sms_sent: boolean
          sms_status: string | null
          sms_status_at: string | null
          status: string
          title: string
          user_id: string | null
          want_push: boolean
          want_sms: boolean
        }
        Insert: {
          attempts?: number
          body: string
          category: string
          created_at?: string
          dedupe_key: string
          group_id: string
          id?: string
          last_error?: string | null
          member_id?: string | null
          message_id?: string | null
          phone_e164?: string | null
          push_sent?: boolean
          send_after?: string
          sent_at?: string | null
          sms_body?: string | null
          sms_sent?: boolean
          sms_status?: string | null
          sms_status_at?: string | null
          status?: string
          title: string
          user_id?: string | null
          want_push?: boolean
          want_sms?: boolean
        }
        Update: {
          attempts?: number
          body?: string
          category?: string
          created_at?: string
          dedupe_key?: string
          group_id?: string
          id?: string
          last_error?: string | null
          member_id?: string | null
          message_id?: string | null
          phone_e164?: string | null
          push_sent?: boolean
          send_after?: string
          sent_at?: string | null
          sms_body?: string | null
          sms_sent?: boolean
          sms_status?: string | null
          sms_status_at?: string | null
          status?: string
          title?: string
          user_id?: string | null
          want_push?: boolean
          want_sms?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "notifications_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "group_summaries"
            referencedColumns: ["group_id"]
          },
          {
            foreignKeyName: "notifications_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "group_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "member_standings"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "notifications_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "pending_join_requests"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "notifications_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "user_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "group_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      obligations: {
        Row: {
          amount_due: number
          created_at: string
          cycle_id: string
          id: string
          member_id: string
          waived: boolean
          waived_reason: string | null
        }
        Insert: {
          amount_due: number
          created_at?: string
          cycle_id: string
          id?: string
          member_id: string
          waived?: boolean
          waived_reason?: string | null
        }
        Update: {
          amount_due?: number
          created_at?: string
          cycle_id?: string
          id?: string
          member_id?: string
          waived?: boolean
          waived_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "obligations_cycle_id_fkey"
            columns: ["cycle_id"]
            isOneToOne: false
            referencedRelation: "cycles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obligations_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "group_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obligations_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "member_standings"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "obligations_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "pending_join_requests"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "obligations_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "user_organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_sms_balances: {
        Row: {
          bonus_credits_received: number
          credit_balance: number
          organization_id: string
          updated_at: string
        }
        Insert: {
          bonus_credits_received?: number
          credit_balance?: number
          organization_id: string
          updated_at?: string
        }
        Update: {
          bonus_credits_received?: number
          credit_balance?: number
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_sms_balances_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "group_summaries"
            referencedColumns: ["group_id"]
          },
          {
            foreignKeyName: "organization_sms_balances_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_sms_balances_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_records: {
        Row: {
          amount_paid: number
          created_at: string
          credits_purchased: number
          currency: string
          gateway_reference: string
          id: string
          organization_id: string
          payment_gateway: string
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          amount_paid: number
          created_at?: string
          credits_purchased: number
          currency?: string
          gateway_reference: string
          id?: string
          organization_id: string
          payment_gateway?: string
          status: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          amount_paid?: number
          created_at?: string
          credits_purchased?: number
          currency?: string
          gateway_reference?: string
          id?: string
          organization_id?: string
          payment_gateway?: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_records_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "group_summaries"
            referencedColumns: ["group_id"]
          },
          {
            foreignKeyName: "payment_records_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_records_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          confirmed_by: string | null
          created_at: string
          designated_plan_id: string | null
          group_id: string
          id: string
          member_id: string
          method: Database["public"]["Enums"]["payment_method"]
          note: string | null
          paid_at: string
          receipt_url: string | null
          recorded_by: string
          reference: string | null
          reverses_payment_id: string | null
          status: Database["public"]["Enums"]["payment_status"]
        }
        Insert: {
          amount: number
          confirmed_by?: string | null
          created_at?: string
          designated_plan_id?: string | null
          group_id: string
          id?: string
          member_id: string
          method: Database["public"]["Enums"]["payment_method"]
          note?: string | null
          paid_at?: string
          receipt_url?: string | null
          recorded_by: string
          reference?: string | null
          reverses_payment_id?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
        }
        Update: {
          amount?: number
          confirmed_by?: string | null
          created_at?: string
          designated_plan_id?: string | null
          group_id?: string
          id?: string
          member_id?: string
          method?: Database["public"]["Enums"]["payment_method"]
          note?: string | null
          paid_at?: string
          receipt_url?: string | null
          recorded_by?: string
          reference?: string | null
          reverses_payment_id?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
        }
        Relationships: [
          {
            foreignKeyName: "payments_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "group_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "member_standings"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "payments_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "pending_join_requests"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "payments_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "user_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_designated_plan_id_fkey"
            columns: ["designated_plan_id"]
            isOneToOne: false
            referencedRelation: "plan_summaries"
            referencedColumns: ["plan_id"]
          },
          {
            foreignKeyName: "payments_designated_plan_id_fkey"
            columns: ["designated_plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "group_summaries"
            referencedColumns: ["group_id"]
          },
          {
            foreignKeyName: "payments_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "group_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "member_standings"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "payments_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "pending_join_requests"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "payments_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "user_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "group_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "member_standings"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "payments_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "pending_join_requests"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "payments_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "user_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_reverses_payment_id_fkey"
            columns: ["reverses_payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_member_overrides: {
        Row: {
          amount: number | null
          id: string
          member_id: string
          plan_id: string
          reason: string | null
        }
        Insert: {
          amount?: number | null
          id?: string
          member_id: string
          plan_id: string
          reason?: string | null
        }
        Update: {
          amount?: number | null
          id?: string
          member_id?: string
          plan_id?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "plan_member_overrides_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "group_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_member_overrides_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "member_standings"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "plan_member_overrides_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "pending_join_requests"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "plan_member_overrides_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "user_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_member_overrides_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plan_summaries"
            referencedColumns: ["plan_id"]
          },
          {
            foreignKeyName: "plan_member_overrides_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_tag_amounts: {
        Row: {
          amount: number
          created_at: string
          id: string
          plan_id: string
          rank: number
          tag_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          plan_id: string
          rank?: number
          tag_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          plan_id?: string
          rank?: number
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_tag_amounts_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plan_summaries"
            referencedColumns: ["plan_id"]
          },
          {
            foreignKeyName: "plan_tag_amounts_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_tag_amounts_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tag_summaries"
            referencedColumns: ["tag_id"]
          },
          {
            foreignKeyName: "plan_tag_amounts_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          audience_tag_id: string | null
          created_at: string
          created_by: string
          default_amount: number | null
          end_date: string | null
          frequency: Database["public"]["Enums"]["plan_frequency"]
          grace_days: number
          group_id: string
          id: string
          kind: Database["public"]["Enums"]["plan_kind"]
          name: string
          start_date: string
          status: Database["public"]["Enums"]["plan_status"]
          updated_at: string
        }
        Insert: {
          audience_tag_id?: string | null
          created_at?: string
          created_by: string
          default_amount?: number | null
          end_date?: string | null
          frequency: Database["public"]["Enums"]["plan_frequency"]
          grace_days?: number
          group_id: string
          id?: string
          kind: Database["public"]["Enums"]["plan_kind"]
          name: string
          start_date: string
          status?: Database["public"]["Enums"]["plan_status"]
          updated_at?: string
        }
        Update: {
          audience_tag_id?: string | null
          created_at?: string
          created_by?: string
          default_amount?: number | null
          end_date?: string | null
          frequency?: Database["public"]["Enums"]["plan_frequency"]
          grace_days?: number
          group_id?: string
          id?: string
          kind?: Database["public"]["Enums"]["plan_kind"]
          name?: string
          start_date?: string
          status?: Database["public"]["Enums"]["plan_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "plans_audience_tag_id_fkey"
            columns: ["audience_tag_id"]
            isOneToOne: false
            referencedRelation: "tag_summaries"
            referencedColumns: ["tag_id"]
          },
          {
            foreignKeyName: "plans_audience_tag_id_fkey"
            columns: ["audience_tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plans_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "group_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plans_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "member_standings"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "plans_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "pending_join_requests"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "plans_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plans_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "group_summaries"
            referencedColumns: ["group_id"]
          },
          {
            foreignKeyName: "plans_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plans_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string
          id: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string
          id: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string
          id?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      rotation_slots: {
        Row: {
          cycle_id: string | null
          expected_payout: number | null
          id: string
          member_id: string
          note: string | null
          paid_out_amount: number | null
          paid_out_at: string | null
          payout_expense_id: string | null
          plan_id: string
          position: number
        }
        Insert: {
          cycle_id?: string | null
          expected_payout?: number | null
          id?: string
          member_id: string
          note?: string | null
          paid_out_amount?: number | null
          paid_out_at?: string | null
          payout_expense_id?: string | null
          plan_id: string
          position: number
        }
        Update: {
          cycle_id?: string | null
          expected_payout?: number | null
          id?: string
          member_id?: string
          note?: string | null
          paid_out_amount?: number | null
          paid_out_at?: string | null
          payout_expense_id?: string | null
          plan_id?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "rotation_slots_cycle_id_fkey"
            columns: ["cycle_id"]
            isOneToOne: true
            referencedRelation: "cycles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rotation_slots_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "group_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rotation_slots_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "member_standings"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "rotation_slots_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "pending_join_requests"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "rotation_slots_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "user_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rotation_slots_payout_expense_id_fkey"
            columns: ["payout_expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rotation_slots_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plan_summaries"
            referencedColumns: ["plan_id"]
          },
          {
            foreignKeyName: "rotation_slots_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      sender_id_requests: {
        Row: {
          created_at: string
          group_id: string
          id: string
          reason: string
          rejection_reason: string | null
          requested_by: string | null
          sender_id: string
          status: Database["public"]["Enums"]["sender_id_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          group_id: string
          id?: string
          reason: string
          rejection_reason?: string | null
          requested_by?: string | null
          sender_id: string
          status?: Database["public"]["Enums"]["sender_id_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          group_id?: string
          id?: string
          reason?: string
          rejection_reason?: string | null
          requested_by?: string | null
          sender_id?: string
          status?: Database["public"]["Enums"]["sender_id_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sender_id_requests_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "group_summaries"
            referencedColumns: ["group_id"]
          },
          {
            foreignKeyName: "sender_id_requests_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sender_id_requests_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sender_id_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "group_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sender_id_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "member_standings"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "sender_id_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "pending_join_requests"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "sender_id_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "user_organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_credit_transactions: {
        Row: {
          amount: number
          created_at: string
          description: string
          id: string
          metadata: Json
          organization_id: string
          type: string
        }
        Insert: {
          amount: number
          created_at?: string
          description: string
          id?: string
          metadata?: Json
          organization_id: string
          type: string
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string
          id?: string
          metadata?: Json
          organization_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "sms_credit_transactions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "group_summaries"
            referencedColumns: ["group_id"]
          },
          {
            foreignKeyName: "sms_credit_transactions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_credit_transactions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      tags: {
        Row: {
          colour: string
          created_at: string
          group_id: string
          id: string
          name: string
        }
        Insert: {
          colour?: string
          created_at?: string
          group_id: string
          id?: string
          name: string
        }
        Update: {
          colour?: string
          created_at?: string
          group_id?: string
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "tags_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "group_summaries"
            referencedColumns: ["group_id"]
          },
          {
            foreignKeyName: "tags_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tags_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      duplicate_member_phones: {
        Row: {
          group_id: string | null
          member_count: number | null
          member_ids: string[] | null
          member_names: string[] | null
          phone_e164: string | null
        }
        Relationships: [
          {
            foreignKeyName: "group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "group_summaries"
            referencedColumns: ["group_id"]
          },
          {
            foreignKeyName: "group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      group_summaries: {
        Row: {
          active_members: number | null
          cash_on_hand: number | null
          group_id: string | null
          pending_expenses: number | null
          total_collected: number | null
          total_expenses: number | null
        }
        Insert: {
          active_members?: never
          cash_on_hand?: never
          group_id?: string | null
          pending_expenses?: never
          total_collected?: never
          total_expenses?: never
        }
        Update: {
          active_members?: never
          cash_on_hand?: never
          group_id?: string | null
          pending_expenses?: never
          total_collected?: never
          total_expenses?: never
        }
        Relationships: []
      }
      member_link_notices: {
        Row: {
          acknowledged_at: string | null
          created_at: string | null
          event_id: string | null
          group_id: string | null
          kind: string | null
          member_id: string | null
          member_name: string | null
          phone_e164: string | null
        }
        Relationships: [
          {
            foreignKeyName: "member_link_events_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "group_summaries"
            referencedColumns: ["group_id"]
          },
          {
            foreignKeyName: "member_link_events_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_link_events_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_link_events_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "group_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_link_events_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "member_standings"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "member_link_events_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "pending_join_requests"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "member_link_events_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "user_organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      member_standings: {
        Row: {
          balance: number | null
          credit: number | null
          group_id: string | null
          member_id: string | null
          total_due: number | null
          total_paid: number | null
        }
        Relationships: [
          {
            foreignKeyName: "group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "group_summaries"
            referencedColumns: ["group_id"]
          },
          {
            foreignKeyName: "group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      obligation_balances: {
        Row: {
          amount_due: number | null
          amount_paid: number | null
          balance: number | null
          cycle_id: string | null
          member_id: string | null
          obligation_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "obligations_cycle_id_fkey"
            columns: ["cycle_id"]
            isOneToOne: false
            referencedRelation: "cycles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obligations_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "group_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obligations_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "member_standings"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "obligations_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "pending_join_requests"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "obligations_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "user_organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string | null
          currency: string | null
          email: string | null
          has_purchased: boolean | null
          id: string | null
          is_active: boolean | null
          name: string | null
          phone: string | null
          sms_sender_id: string | null
          trial_end_date: string | null
          updated_at: string | null
        }
        Relationships: []
      }
      pending_join_requests: {
        Row: {
          full_name: string | null
          group_id: string | null
          member_id: string | null
          merges_into: string | null
          phone: string | null
          phone_e164: string | null
          requested_at: string | null
        }
        Insert: {
          full_name?: string | null
          group_id?: string | null
          member_id?: string | null
          merges_into?: never
          phone?: string | null
          phone_e164?: string | null
          requested_at?: string | null
        }
        Update: {
          full_name?: string | null
          group_id?: string | null
          member_id?: string | null
          merges_into?: never
          phone?: string | null
          phone_e164?: string | null
          requested_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "group_summaries"
            referencedColumns: ["group_id"]
          },
          {
            foreignKeyName: "group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_summaries: {
        Row: {
          cycle_count: number | null
          extra_giving: number | null
          group_id: string | null
          has_money: boolean | null
          plan_id: string | null
          total_collected: number | null
          total_expected: number | null
        }
        Relationships: [
          {
            foreignKeyName: "plans_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "group_summaries"
            referencedColumns: ["group_id"]
          },
          {
            foreignKeyName: "plans_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plans_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_tag_amount_details: {
        Row: {
          amount: number | null
          member_count: number | null
          plan_id: string | null
          rank: number | null
          tag_colour: string | null
          tag_id: string | null
          tag_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "plan_tag_amounts_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plan_summaries"
            referencedColumns: ["plan_id"]
          },
          {
            foreignKeyName: "plan_tag_amounts_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_tag_amounts_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tag_summaries"
            referencedColumns: ["tag_id"]
          },
          {
            foreignKeyName: "plan_tag_amounts_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      rotation_status: {
        Row: {
          collected_so_far: number | null
          cycle_id: string | null
          cycle_label: string | null
          due_date: string | null
          expected_pot: number | null
          group_id: string | null
          member_id: string | null
          member_name: string | null
          member_status: Database["public"]["Enums"]["member_status"] | null
          note: string | null
          paid_out_amount: number | null
          paid_out_at: string | null
          plan_id: string | null
          position: number | null
          slot_id: string | null
          slot_status: string | null
        }
        Relationships: [
          {
            foreignKeyName: "plans_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "group_summaries"
            referencedColumns: ["group_id"]
          },
          {
            foreignKeyName: "plans_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plans_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rotation_slots_cycle_id_fkey"
            columns: ["cycle_id"]
            isOneToOne: true
            referencedRelation: "cycles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rotation_slots_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "group_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rotation_slots_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "member_standings"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "rotation_slots_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "pending_join_requests"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "rotation_slots_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "user_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rotation_slots_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plan_summaries"
            referencedColumns: ["plan_id"]
          },
          {
            foreignKeyName: "rotation_slots_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      tag_summaries: {
        Row: {
          colour: string | null
          created_at: string | null
          group_id: string | null
          member_count: number | null
          name: string | null
          plan_count: number | null
          tag_id: string | null
        }
        Insert: {
          colour?: string | null
          created_at?: string | null
          group_id?: string | null
          member_count?: never
          name?: string | null
          plan_count?: never
          tag_id?: string | null
        }
        Update: {
          colour?: string | null
          created_at?: string | null
          group_id?: string | null
          member_count?: never
          name?: string | null
          plan_count?: never
          tag_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tags_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "group_summaries"
            referencedColumns: ["group_id"]
          },
          {
            foreignKeyName: "tags_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tags_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_organizations: {
        Row: {
          created_at: string | null
          id: string | null
          is_active: boolean | null
          organization_id: string | null
          role: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string | null
          is_active?: never
          organization_id?: string | null
          role?: never
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string | null
          is_active?: never
          organization_id?: string | null
          role?: never
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "group_members_group_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "group_summaries"
            referencedColumns: ["group_id"]
          },
          {
            foreignKeyName: "group_members_group_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_members_group_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      account_deletion_preview: { Args: never; Returns: Json }
      acknowledge_member_link: {
        Args: { p_event_id: string }
        Returns: undefined
      }
      add_member: {
        Args: {
          p_full_name: string
          p_group_id: string
          p_include_past_periods?: boolean
          p_phone?: string
          p_role?: Database["public"]["Enums"]["member_role"]
        }
        Returns: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string
          group_id: string
          id: string
          joined_at: string
          phone: string | null
          phone_e164: string | null
          role: Database["public"]["Enums"]["member_role"]
          status: Database["public"]["Enums"]["member_status"]
          updated_at: string
          user_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "group_members"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      add_sms_credits: {
        Args: {
          p_credits: number
          p_description?: string
          p_metadata?: Json
          p_org_id: string
        }
        Returns: Json
      }
      allocate_payment: { Args: { p_payment_id: string }; Returns: undefined }
      append_to_rotation: {
        Args: { p_member_id: string; p_plan_id: string }
        Returns: {
          cycle_id: string | null
          expected_payout: number | null
          id: string
          member_id: string
          note: string | null
          paid_out_amount: number | null
          paid_out_at: string | null
          payout_expense_id: string | null
          plan_id: string
          position: number
        }
        SetofOptions: {
          from: "*"
          to: "rotation_slots"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      apply_credit: { Args: { p_member_id: string }; Returns: undefined }
      approve_expense: {
        Args: { p_expense_id: string }
        Returns: {
          amount: number
          approved_by: string | null
          category: string
          created_at: string
          group_id: string
          id: string
          note: string | null
          receipt_url: string | null
          recorded_by: string
          spent_at: string
          status: Database["public"]["Enums"]["expense_status"]
          title: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "expenses"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      approve_join_request: {
        Args: { p_include_past_periods?: boolean; p_member_id: string }
        Returns: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string
          group_id: string
          id: string
          joined_at: string
          phone: string | null
          phone_e164: string | null
          role: Database["public"]["Enums"]["member_role"]
          status: Database["public"]["Enums"]["member_status"]
          updated_at: string
          user_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "group_members"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      assign_rotation: {
        Args: { p_member_ids: string[]; p_plan_id: string }
        Returns: number
      }
      claim_memberships: { Args: never; Returns: number }
      clear_plan_override: {
        Args: { p_member_id: string; p_plan_id: string }
        Returns: undefined
      }
      clear_plan_tag_amount: {
        Args: { p_plan_id: string; p_tag_id: string }
        Returns: undefined
      }
      confirm_payment: {
        Args: { p_payment_id: string }
        Returns: {
          amount: number
          confirmed_by: string | null
          created_at: string
          designated_plan_id: string | null
          group_id: string
          id: string
          member_id: string
          method: Database["public"]["Enums"]["payment_method"]
          note: string | null
          paid_at: string
          receipt_url: string | null
          recorded_by: string
          reference: string | null
          reverses_payment_id: string | null
          status: Database["public"]["Enums"]["payment_status"]
        }
        SetofOptions: {
          from: "*"
          to: "payments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_group: {
        Args: { p_currency?: string; p_name: string }
        Returns: {
          brand_colour: string | null
          created_at: string
          created_by: string | null
          currency: string
          description: string | null
          id: string
          join_code: string
          join_code_expires_at: string | null
          join_requires_approval: boolean
          logo_url: string | null
          name: string
          sms_enabled: boolean
          sms_monthly_cap: number
          sms_sender_id: string | null
          timezone: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "groups"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_plan: {
        Args: {
          p_audience_tag_id?: string
          p_default_amount?: number
          p_end_date?: string
          p_frequency: Database["public"]["Enums"]["plan_frequency"]
          p_grace_days?: number
          p_group_id: string
          p_kind: Database["public"]["Enums"]["plan_kind"]
          p_name: string
          p_start_date?: string
        }
        Returns: {
          audience_tag_id: string | null
          created_at: string
          created_by: string
          default_amount: number | null
          end_date: string | null
          frequency: Database["public"]["Enums"]["plan_frequency"]
          grace_days: number
          group_id: string
          id: string
          kind: Database["public"]["Enums"]["plan_kind"]
          name: string
          start_date: string
          status: Database["public"]["Enums"]["plan_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "plans"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_tag: {
        Args: { p_colour?: string; p_group_id: string; p_name: string }
        Returns: {
          colour: string
          created_at: string
          group_id: string
          id: string
          name: string
        }
        SetofOptions: {
          from: "*"
          to: "tags"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      current_member_id: { Args: { gid: string }; Returns: string }
      current_verified_phone: { Args: never; Returns: string }
      cycle_end_for: {
        Args: {
          p_frequency: Database["public"]["Enums"]["plan_frequency"]
          p_start: string
        }
        Returns: string
      }
      cycle_label_for: {
        Args: {
          p_frequency: Database["public"]["Enums"]["plan_frequency"]
          p_start: string
        }
        Returns: string
      }
      decline_join_request: {
        Args: { p_member_id: string }
        Returns: undefined
      }
      deduct_sms_credits: {
        Args: {
          p_message_count: number
          p_org_id: string
          p_payload: Json
          p_recipient: string
        }
        Returns: Json
      }
      default_join_code_ttl: { Args: never; Returns: string }
      delete_group_cascade: { Args: { p_group_id: string }; Returns: undefined }
      delete_plan: { Args: { p_plan_id: string }; Returns: undefined }
      delete_tag: { Args: { p_tag_id: string }; Returns: undefined }
      dispatch_notifications: { Args: never; Returns: undefined }
      enqueue_for_role: {
        Args: {
          p_body: string
          p_category: string
          p_dedupe_key: string
          p_group_id: string
          p_min_role: Database["public"]["Enums"]["member_role"]
          p_title: string
        }
        Returns: undefined
      }
      enqueue_notification: {
        Args: {
          p_body: string
          p_category: string
          p_dedupe_key?: string
          p_group_id: string
          p_member_id: string
          p_send_after?: string
          p_sms_body?: string
          p_title: string
        }
        Returns: undefined
      }
      gen_join_code: { Args: never; Returns: string }
      generate_cycle: {
        Args: { p_period_start?: string; p_plan_id: string }
        Returns: {
          created_at: string
          due_date: string
          id: string
          label: string
          period_end: string
          period_start: string
          plan_id: string
          status: Database["public"]["Enums"]["cycle_status"]
        }
        SetofOptions: {
          from: "*"
          to: "cycles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      generate_due_cycles: {
        Args: { p_plan_id: string; p_up_to?: string }
        Returns: number
      }
      group_can_send_sms: { Args: { p_group_id: string }; Returns: boolean }
      group_cash_by_method: {
        Args: { p_from: string; p_group_id: string; p_to: string }
        Returns: {
          collected: number
          method: Database["public"]["Enums"]["payment_method"]
          payment_count: number
        }[]
      }
      group_cash_by_plan: {
        Args: { p_from: string; p_group_id: string; p_to: string }
        Returns: {
          collected: number
          plan_id: string
          plan_name: string
        }[]
      }
      group_cash_report: {
        Args: { p_from: string; p_group_id: string; p_to: string }
        Returns: {
          closing_balance: number
          expense_count: number
          money_in: number
          money_out: number
          opening_balance: number
          payment_count: number
        }[]
      }
      group_collections: {
        Args: { p_from: string; p_group_id: string; p_to: string }
        Returns: {
          amount: number
          member_id: string
          member_name: string
          method: Database["public"]["Enums"]["payment_method"]
          paid_at: string
          payment_id: string
          plan_id: string
          plan_name: string
          status: Database["public"]["Enums"]["payment_status"]
        }[]
      }
      group_message_history: {
        Args: { p_group_id: string }
        Returns: {
          audience: string
          body: string
          created_at: string
          delivered: number
          id: string
          not_texted: number
          push_only: boolean
          pushed: number
          recipients: number
          sent_by: string
          tag_name: string
          texted: number
          waiting: number
        }[]
      }
      group_sms_used_this_month: {
        Args: { p_group_id: string }
        Returns: number
      }
      has_group_role: {
        Args: {
          gid: string
          min_role: Database["public"]["Enums"]["member_role"]
        }
        Returns: boolean
      }
      is_group_member: { Args: { gid: string }; Returns: boolean }
      issue_member_obligations: {
        Args: { p_include_past_periods?: boolean; p_member_id: string }
        Returns: number
      }
      join_group: {
        Args: { p_join_code: string }
        Returns: {
          brand_colour: string | null
          created_at: string
          created_by: string | null
          currency: string
          description: string | null
          id: string
          join_code: string
          join_code_expires_at: string | null
          join_requires_approval: boolean
          logo_url: string | null
          name: string
          sms_enabled: boolean
          sms_monthly_cap: number
          sms_sender_id: string | null
          timezone: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "groups"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      link_rotation_cycles: { Args: { p_plan_id: string }; Returns: undefined }
      link_target_for_phone: {
        Args: { p_group_id: string; p_phone: string }
        Returns: {
          candidates: number
          member_id: string
          member_name: string
        }[]
      }
      member_arrears_report: {
        Args: { p_from?: string; p_group_id: string; p_to?: string }
        Returns: {
          balance: number
          credit: number
          full_name: string
          last_paid_at: string
          member_id: string
          periods_owed: number
          phone: string
          role: Database["public"]["Enums"]["member_role"]
          total_due: number
          total_paid: number
        }[]
      }
      message_push_text: {
        Args: { p_body: string; p_full_name: string }
        Returns: string
      }
      message_recipients: {
        Args: {
          p_audience: string
          p_group_id: string
          p_member_ids: string[]
          p_tag_id: string
        }
        Returns: {
          can_push: boolean
          can_sms: boolean
          full_name: string
          member_id: string
        }[]
      }
      message_sms_text: {
        Args: {
          p_body: string
          p_full_name: string
          p_group_name: string
          p_sender_id: string
        }
        Returns: string
      }
      my_join_requests: {
        Args: never
        Returns: {
          group_id: string
          group_name: string
          member_id: string
          requested_at: string
        }[]
      }
      next_cycle_start: {
        Args: {
          p_frequency: Database["public"]["Enums"]["plan_frequency"]
          p_start: string
        }
        Returns: string
      }
      next_sendable_at: {
        Args: { p_group_id: string; p_now?: string }
        Returns: string
      }
      normalise_gh_phone: { Args: { p_phone: string }; Returns: string }
      plan_has_money: { Args: { p_plan_id: string }; Returns: boolean }
      plan_member_report: {
        Args: { p_plan_id: string }
        Returns: {
          balance: number
          full_name: string
          member_id: string
          total_due: number
          total_paid: number
        }[]
      }
      plan_obligation_amount: {
        Args: { p_member_id: string; p_plan_id: string }
        Returns: number
      }
      prepare_account_deletion: { Args: never; Returns: Json }
      preview_group_message: {
        Args: {
          p_audience: string
          p_body: string
          p_group_id: string
          p_member_ids?: string[]
          p_tag_id?: string
        }
        Returns: Json
      }
      prune_misaligned_cycles: { Args: { p_plan_id: string }; Returns: number }
      purging_group: {
        Args: { p_group_id: string; p_table: string }
        Returns: boolean
      }
      queue_invite_expiry_warnings: { Args: never; Returns: number }
      queue_overdue_reminders: { Args: never; Returns: number }
      queue_period_reminders: { Args: never; Returns: number }
      realign_cycles: { Args: { p_plan_id: string }; Returns: number }
      record_expense: {
        Args: {
          p_amount: number
          p_category?: string
          p_group_id: string
          p_note?: string
          p_spent_at?: string
          p_title: string
        }
        Returns: {
          amount: number
          approved_by: string | null
          category: string
          created_at: string
          group_id: string
          id: string
          note: string | null
          receipt_url: string | null
          recorded_by: string
          spent_at: string
          status: Database["public"]["Enums"]["expense_status"]
          title: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "expenses"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_payment: {
        Args: {
          p_amount: number
          p_designated_plan_id?: string
          p_group_id: string
          p_member_id: string
          p_method: Database["public"]["Enums"]["payment_method"]
          p_note?: string
          p_paid_at?: string
          p_reference?: string
        }
        Returns: {
          amount: number
          confirmed_by: string | null
          created_at: string
          designated_plan_id: string | null
          group_id: string
          id: string
          member_id: string
          method: Database["public"]["Enums"]["payment_method"]
          note: string | null
          paid_at: string
          receipt_url: string | null
          recorded_by: string
          reference: string | null
          reverses_payment_id: string | null
          status: Database["public"]["Enums"]["payment_status"]
        }
        SetofOptions: {
          from: "*"
          to: "payments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_payout: {
        Args: {
          p_amount: number
          p_note?: string
          p_settle_arrears?: boolean
          p_slot_id: string
        }
        Returns: {
          cycle_id: string | null
          expected_payout: number | null
          id: string
          member_id: string
          note: string | null
          paid_out_amount: number | null
          paid_out_at: string | null
          payout_expense_id: string | null
          plan_id: string
          position: number
        }
        SetofOptions: {
          from: "*"
          to: "rotation_slots"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_sms_delivery: {
        Args: { p_recipient: string; p_ref: string; p_status: string }
        Returns: undefined
      }
      regenerate_join_code: {
        Args: { p_days?: number; p_group_id: string }
        Returns: {
          brand_colour: string | null
          created_at: string
          created_by: string | null
          currency: string
          description: string | null
          id: string
          join_code: string
          join_code_expires_at: string | null
          join_requires_approval: boolean
          logo_url: string | null
          name: string
          sms_enabled: boolean
          sms_monthly_cap: number
          sms_sender_id: string | null
          timezone: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "groups"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reissue_plan_obligations: {
        Args: { p_include_past_periods?: boolean; p_plan_id: string }
        Returns: number
      }
      reissue_plans_for_tag: {
        Args: { p_include_past_periods?: boolean; p_tag_id: string }
        Returns: undefined
      }
      reject_expense: {
        Args: { p_expense_id: string; p_reason: string }
        Returns: {
          amount: number
          approved_by: string | null
          category: string
          created_at: string
          group_id: string
          id: string
          note: string | null
          receipt_url: string | null
          recorded_by: string
          spent_at: string
          status: Database["public"]["Enums"]["expense_status"]
          title: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "expenses"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      rename_tag: {
        Args: { p_colour?: string; p_name?: string; p_tag_id: string }
        Returns: {
          colour: string
          created_at: string
          group_id: string
          id: string
          name: string
        }
        SetofOptions: {
          from: "*"
          to: "tags"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      replace_rotation_member: {
        Args: { p_member_id: string; p_slot_id: string }
        Returns: {
          cycle_id: string | null
          expected_payout: number | null
          id: string
          member_id: string
          note: string | null
          paid_out_amount: number | null
          paid_out_at: string | null
          payout_expense_id: string | null
          plan_id: string
          position: number
        }
        SetofOptions: {
          from: "*"
          to: "rotation_slots"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reprice_plan_obligations: { Args: { p_plan_id: string }; Returns: number }
      reverse_payment: {
        Args: { p_payment_id: string; p_reason: string }
        Returns: {
          amount: number
          confirmed_by: string | null
          created_at: string
          designated_plan_id: string | null
          group_id: string
          id: string
          member_id: string
          method: Database["public"]["Enums"]["payment_method"]
          note: string | null
          paid_at: string
          receipt_url: string | null
          recorded_by: string
          reference: string | null
          reverses_payment_id: string | null
          status: Database["public"]["Enums"]["payment_status"]
        }
        SetofOptions: {
          from: "*"
          to: "payments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reverse_payout: {
        Args: { p_reason: string; p_slot_id: string }
        Returns: {
          cycle_id: string | null
          expected_payout: number | null
          id: string
          member_id: string
          note: string | null
          paid_out_amount: number | null
          paid_out_at: string | null
          payout_expense_id: string | null
          plan_id: string
          position: number
        }
        SetofOptions: {
          from: "*"
          to: "rotation_slots"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      role_rank: {
        Args: { r: Database["public"]["Enums"]["member_role"] }
        Returns: number
      }
      rotation_end_date: {
        Args: { p_plan_id: string; p_positions: number }
        Returns: string
      }
      send_group_message: {
        Args: {
          p_audience: string
          p_body: string
          p_group_id: string
          p_member_ids?: string[]
          p_push_only?: boolean
          p_tag_id?: string
        }
        Returns: Json
      }
      set_join_policy: {
        Args: { p_group_id: string; p_requires_approval: boolean }
        Returns: {
          brand_colour: string | null
          created_at: string
          created_by: string | null
          currency: string
          description: string | null
          id: string
          join_code: string
          join_code_expires_at: string | null
          join_requires_approval: boolean
          logo_url: string | null
          name: string
          sms_enabled: boolean
          sms_monthly_cap: number
          sms_sender_id: string | null
          timezone: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "groups"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_member_role: {
        Args: {
          p_member_id: string
          p_role: Database["public"]["Enums"]["member_role"]
        }
        Returns: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string
          group_id: string
          id: string
          joined_at: string
          phone: string | null
          phone_e164: string | null
          role: Database["public"]["Enums"]["member_role"]
          status: Database["public"]["Enums"]["member_status"]
          updated_at: string
          user_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "group_members"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_member_tags: {
        Args: {
          p_include_past_periods?: boolean
          p_member_id: string
          p_tag_ids: string[]
        }
        Returns: number
      }
      set_my_avatar: {
        Args: { p_avatar_url: string }
        Returns: {
          avatar_url: string | null
          created_at: string
          full_name: string
          id: string
          phone: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_my_name: {
        Args: { p_full_name: string }
        Returns: {
          avatar_url: string | null
          created_at: string
          full_name: string
          id: string
          phone: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_plan_audience: {
        Args: { p_plan_id: string; p_tag_id?: string }
        Returns: {
          audience_tag_id: string | null
          created_at: string
          created_by: string
          default_amount: number | null
          end_date: string | null
          frequency: Database["public"]["Enums"]["plan_frequency"]
          grace_days: number
          group_id: string
          id: string
          kind: Database["public"]["Enums"]["plan_kind"]
          name: string
          start_date: string
          status: Database["public"]["Enums"]["plan_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "plans"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_plan_override: {
        Args: {
          p_amount?: number
          p_member_id: string
          p_plan_id: string
          p_reason?: string
        }
        Returns: {
          amount: number | null
          id: string
          member_id: string
          plan_id: string
          reason: string | null
        }
        SetofOptions: {
          from: "*"
          to: "plan_member_overrides"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_plan_tag_amount: {
        Args: {
          p_amount: number
          p_plan_id: string
          p_rank?: number
          p_tag_id: string
        }
        Returns: {
          amount: number
          created_at: string
          id: string
          plan_id: string
          rank: number
          tag_id: string
        }
        SetofOptions: {
          from: "*"
          to: "plan_tag_amounts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_tag_members: {
        Args: {
          p_include_past_periods?: boolean
          p_member_ids: string[]
          p_tag_id: string
        }
        Returns: number
      }
      sms_credit_estimate: { Args: { p_text: string }; Returns: number }
      sms_normalise: { Args: { p_text: string }; Returns: string }
      update_plan: {
        Args: {
          p_default_amount?: number
          p_end_date?: string
          p_grace_days?: number
          p_name?: string
          p_plan_id: string
          p_start_date?: string
          p_status?: Database["public"]["Enums"]["plan_status"]
        }
        Returns: {
          audience_tag_id: string | null
          created_at: string
          created_by: string
          default_amount: number | null
          end_date: string | null
          frequency: Database["public"]["Enums"]["plan_frequency"]
          grace_days: number
          group_id: string
          id: string
          kind: Database["public"]["Enums"]["plan_kind"]
          name: string
          start_date: string
          status: Database["public"]["Enums"]["plan_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "plans"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      void_expense: {
        Args: { p_expense_id: string; p_reason: string }
        Returns: {
          amount: number
          approved_by: string | null
          category: string
          created_at: string
          group_id: string
          id: string
          note: string | null
          receipt_url: string | null
          recorded_by: string
          spent_at: string
          status: Database["public"]["Enums"]["expense_status"]
          title: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "expenses"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      cycle_status: "upcoming" | "open" | "closed"
      expense_status: "pending" | "approved" | "rejected"
      member_role: "owner" | "admin" | "treasurer" | "auditor" | "member"
      member_status: "active" | "invited" | "suspended" | "left" | "pending"
      payment_method: "cash" | "momo" | "bank" | "cheque" | "card" | "other"
      payment_status: "pending" | "confirmed" | "rejected" | "reversed"
      plan_frequency:
        | "daily"
        | "weekly"
        | "biweekly"
        | "monthly"
        | "quarterly"
        | "yearly"
        | "once"
      plan_kind:
        | "dues"
        | "contribution"
        | "levy"
        | "open"
        | "rotating"
        | "savings"
      plan_status: "draft" | "active" | "paused" | "ended"
      sender_id_status: "pending" | "approved" | "rejected"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      cycle_status: ["upcoming", "open", "closed"],
      expense_status: ["pending", "approved", "rejected"],
      member_role: ["owner", "admin", "treasurer", "auditor", "member"],
      member_status: ["active", "invited", "suspended", "left", "pending"],
      payment_method: ["cash", "momo", "bank", "cheque", "card", "other"],
      payment_status: ["pending", "confirmed", "rejected", "reversed"],
      plan_frequency: [
        "daily",
        "weekly",
        "biweekly",
        "monthly",
        "quarterly",
        "yearly",
        "once",
      ],
      plan_kind: [
        "dues",
        "contribution",
        "levy",
        "open",
        "rotating",
        "savings",
      ],
      plan_status: ["draft", "active", "paused", "ended"],
      sender_id_status: ["pending", "approved", "rejected"],
    },
  },
} as const
